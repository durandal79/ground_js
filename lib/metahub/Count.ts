/// <reference path="../references.ts"/>

module Ground {
  export class Record_Count extends MetaHub.Meta_Object {
    ground:Core
    parent:Trellis
    child:Trellis
    count_name:string

    constructor(ground:Core, parent, property_name:string, count_name:string) {
      super()
      this.ground = ground
      this.parent = ground.sanitize_trellis_argument(parent)
      var property = this.parent.get_property(property_name)
      this.child = property.other_trellis
      this.count_name = count_name

      this.listen(ground, this.child.name + '.created', (seed, update) => this.count(seed))
      this.listen(ground, this.child.name + '.deleted', (seed, update) => this.count(seed))
    }

    count(seed):Promise {
      var back_reference = this.child.get_reference_property(this.parent)
      return this.child.assure_properties(seed, [back_reference.name])
        .then((seed)=> {
          var parent_key = back_reference.get_sql_value(seed[back_reference.name])

          var sql = "UPDATE " + this.parent.get_table_name()
            + "\nSET " + this.count_name + " ="
            + "\n(SELECT COUNT(*)"
            + "\nFROM " + this.child.get_table_name() + " WHERE " + back_reference.query() + " = " + parent_key + ")"
            + "\nWHERE " + this.parent.query_primary_key() + " = " + parent_key

          return this.ground.db.query(sql, [ parent_key ])
            .then(() => this.invoke('changed', parent_key))
        })
    }
  }

  export class Join_Count extends MetaHub.Meta_Object {
    ground:Core
    parent:Trellis
    link:Cross_Trellis
    count_name:string
    property:Property

    constructor(ground:Core, property:Property, count_name:string) {
      super()
      this.ground = ground
      this.parent = property.parent
      this.count_name = count_name
      this.link = new Cross_Trellis(property)
      this.link.alias = this.link.name
      this.property = property

      var table_name = this.link.get_table_name()
      this.listen(ground, table_name + '.created', (seed, property) => this.count(seed, property))
      this.listen(ground, table_name + '.removed', (seed, property) => this.count(seed, property))
    }

    count(seed, property:Property):Promise {
      var key_name
      if (property == this.property) {
        key_name = this.property.parent.primary_key
      }
      else {
        key_name = property.name
      }

      return property.parent.assure_properties(seed, [key_name])
        .then((seed)=> {

          var trellis = this.property.parent
//          console.log('seed', seed)
          var initial_key_value = MetaHub.is_array(seed[key_name])
            ? seed[key_name][0]
            : seed[key_name]

          var key = trellis.get_primary_property().get_sql_value(initial_key_value)
          var identities = this.link.order_identities(this.property)

          var sql =
            "UPDATE " + this.parent.get_table_name()
              + "\nSET " + this.count_name + " ="
              + "\n(SELECT COUNT(*)"
              + "\nFROM " + this.link.get_table_name()
              + "\nWHERE " + identities[0].query() + ' = ' + trellis.query_primary_key() + ")"
              + "\nWHERE " + trellis.query_primary_key() + " = " + key

//          console.log('update', sql)
          return this.ground.db.query(sql)
            .then(() => this.invoke('changed', key))
        })
    }
  }

  export class Multi_Count extends MetaHub.Meta_Object {
    ground:Core
    trellis:Trellis
    count_name:string
    count_fields:string[]

    constructor(ground:Core, trellis:string, count_name, sources:MetaHub.Meta_Object[]) {
      super()
      this.ground = ground
      this.trellis = ground.trellises[trellis]
      this.count_name = count_name
      this.count_fields = sources.map((c)=> <string>c['count_name'])
      for (var i in sources) {
        this.listen(sources[i], 'changed', (key) => this.count(key))
      }
    }

    count(key):Promise {
//    console.log('!!! multi')
      var trellis = this.trellis
//      var identity = typeof seed == 'object' ? seed[trellis.primary_key] : seed
//      var trellis_key = trellis.properties[trellis.primary_key].get_sql_value(identity)
      var sql = "UPDATE " + trellis.get_table_name()
        + " SET " + this.count_name + " =\n"
        + this.count_fields.join(' + ') + " "
        + "WHERE " + trellis.query_primary_key() + " = ?"

      return this.ground.db.query(sql, [ key ])
        .then(() => this.invoke('changed'))
    }
  }
}