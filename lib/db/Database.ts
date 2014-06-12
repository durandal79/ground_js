/// <reference path="../references.ts"/>
/// <reference path="../../defs/mysql.d.ts"/>
/// <reference path="../../../vineyard-metahub/metahub.d.ts"/>

var when = require('when')
var mysql = require('mysql')

module Ground {
  export class Database {
    settings
    database:string
    log_queries:boolean = false
    pool
    active:boolean = true

    constructor(settings:{
    }, database:string) {
      this.settings = settings
      this.database = database
      var mysql = require('mysql')
      this.pool = mysql.createPool(this.settings[this.database])
    }

    add_table_to_database(table:Table, ground:Core):Promise {
      var sql = table.create_sql(ground)
      return this.query(sql)
        .then(()=>table)
    }

    add_non_trellis_tables_to_database(tables:Table[], ground:Core):Promise {
      var non_trellises = MetaHub.filter(tables, (x)=> !x.trellis)
//      console.log('none', non_trellises)
      var promises = MetaHub.map_to_array(non_trellises, (table:Table)=> this.add_table_to_database(table, ground));
      return when.all(promises)
    }

//    add_trellis_table_to_database(table:Table, ground:Core):Promise {
//      var sql = table.create_sql(ground)
//      return this.query(sql)
//        .then(()=>table)
//    }

    start() {
      if (this.active)
        return

      this.pool = mysql.createPool(this.settings[this.database])
      this.active = true
      console.log('db-started.')
    }

    close() {
      if (this.pool) {
        this.pool.end()
        this.pool = null
      }
      this.active = false
    }

    create_table(trellis:Trellis):Promise {
      if (!trellis)
        throw new Error('Empty object was passed to create_table().')

      var table = Table.create_from_trellis(trellis);
      var sql = table.create_sql_from_trellis(trellis);
      return this.query(sql)
        .then(()=>table)
    }

    create_trellis_tables(trellises:Trellis[]):Promise {
//      console.log(Object.keys(trellises));
      var promises = MetaHub.map_to_array(trellises, (trellis:Trellis)=>this.create_table(trellis));
      return when.all(promises)
    }


    drop_all_tables():Promise {
      return when.map(this.get_tables(), (table) => {
        return this.query('DROP TABLE IF EXISTS `' + table + '`');
      });
    }

    get_tables():Promise {
      return when.map(this.query('SHOW TABLES'), (row) => {
        for (var i in row)
          return row[i];

        return null;
      });
    }

    query(sql:string, args:any[] = undefined):Promise {
      var def = when.defer()
//      connection = this.pool.createConnection(this.settings[this.database])
//      connection.connect()
      if (this.log_queries)
        console.log('start', sql)

      this.pool.query(sql, args, (err, rows, fields) => {
        if (err) {
          console.log('error', sql)
          throw err
        }
//        console.log('sql', sql)
        def.resolve(rows, fields)

        return null
      });
//      connection.end()

      return def.promise
    }

    query_single(sql:string, args:any[] = undefined):Promise {
      return this.query(sql, args)
        .then((rows) => rows[0])
    }

  }
}