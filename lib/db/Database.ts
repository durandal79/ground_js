/**
 * User: Chris Johnson
 * Date: 9/19/13
 */
/// <reference path="../references.ts"/>
/// <reference path="../../defs/mysql.d.ts"/>
/// <reference path="../../defs/when.d.ts"/>
var when = require('when');

module Ground {
  export class Database {
    settings:{};
    database:string;

    constructor(settings:{}, database:string) {
      this.settings = settings;
      this.database = database;
    }

    create_table(trellis:Trellis):Promise {
//      console.log('create table: ', trellis.name);
      if (!trellis)
        throw new Error('Empty object was passed to create_table().');

      var table = Table.create_from_trellis(trellis);
      var sql = table.create_sql_from_trellis(trellis);
//      console.log('sql', sql)
      return this.query(sql)
        .then(()=>table)
    }

    create_tables(trellises:Trellis[]):Promise {
//      console.log(Object.keys(trellises));
      var promises = MetaHub.map_to_array(trellises, (trellis:Trellis)=>this.create_table(trellis));
      return when.all(promises)
    }

    drop_all_tables():Promise {
//      return this.query('SET foreign_key_checks = 0')
//        .then(when.map(this.get_tables(),(table) => {
//            console.log('table', table);
//            return this.query('DROP TABLE IF EXISTS ' + table);
//          }))
//        .then(()=> this.query('SET foreign_key_checks = 1'));
      return when.map(this.get_tables(), (table) => {
//        console.log('table', table);
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
      var connection, def = when.defer();
      var mysql = require('mysql')
      connection = mysql.createConnection(this.settings[this.database]);
      connection.connect();
//      console.log('start', sql)
      connection.query(sql, args, (err, rows, fields) => {
        if (err) {
          console.log('error', sql);
          throw err;
        }
//        console.log('sql', sql)
        def.resolve(rows, fields);

        return null;
      });
      connection.end();

      return def.promise;
    }

    query_single(sql:string, args:any[] = undefined):Promise {
      return this.query(sql, args)
        .then((rows) => rows[0])
    }

    }
}