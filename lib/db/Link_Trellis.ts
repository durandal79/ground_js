
/// <reference path="../references.ts"/>

module Ground {

  // Map an entity reference property to a 
  export interface Identity {
    name: string
    trellis:Trellis
    keys:Identity_Key[]
  }

  export interface Identity_Key {
    name: string
    type: string
    property:Property
  }

  export class Link_Trellis implements ITrellis {
    properties
    seed
    table_name:string
    trellises:Trellis[] = []
    trellis_dictionary = {} // Should contain the same values as trellises, just keyed by trellis name
    identities:Identity[]
    alias:string

    constructor(trellises:Trellis[], table_name:string = null) {
      this.trellises = trellises

      for (var i = 0; i < trellises.length; ++i) {
        var trellis = trellises[i]
        this.trellis_dictionary[trellis.name] = trellis
      }

      this.table_name = table_name || trellises.map((t)=> t.get_table_name())
        .sort().join('_')

      this.identities = trellises.map((x)=> this.create_identity(x))
    }

    create_identity(trellis:Trellis):Identity {
      var properties = [], property, name
      var keys = trellis.get_primary_keys()
      for (var i = 0; i < keys.length; ++i) {
        property = keys[i]
        if (property.name == trellis.primary_key)
          name = trellis.name
        else
          name = trellis.name + '_' + property.name

        properties.push(Link_Trellis.create_reference(property, name))
      }

      return {
        name: trellis.name,
        trellis: trellis,
        keys: properties
      }
    }

    static create_from_property(property:Property):Link_Trellis {
      var field = property.get_field_override()
      var table_name = field ? field.other_table : null

      var trellises = [
        property.parent,
        property.other_trellis]
      return new Link_Trellis(trellises, table_name)
    }

    static create_reference(property:Property, name:string):Identity_Key {
      return {
        name: name,
        type: property.type,
        property: property
      }
    }

    generate_join(seeds:{
    }) {
//      var sql = "JOIN %table_name ON %table_name.%second_key = " + id +
//        " AND %table_name.%first_key = %back_id\n";

      return 'JOIN ' + this.get_table_declaration() + ' ON ' + this.get_condition_string(seeds) + "\n"
    }

    generate_delete_row(seeds:any[]):string {
//      var sql = "DELETE FROM %table_name WHERE %table_name.%first_key = " + first_id +
//        " AND %table_name.%second_key = " + second_id + "\n;"
//      return Link_Trellis2.populate_sql(sql, this.args);
      return 'DELETE ' + this.table_name + ' ON ' + this.get_condition_string(seeds) + "\n"
    }

    generate_insert(seeds):string {
      var values = [], keys = []
//      console.log('seeds', seeds)
//      console.log('properties', this.identities)
      for (var i in this.identities) {
        var identity:Identity = this.identities[i], seed = seeds[identity.trellis.name]
        for (var p in identity.keys) {
          var key = identity.keys[p], value
          keys.push(key.name)
          if (typeof seed === 'object')
            value = seed[key.property.name]
          else
            value = seed

          values.push(key.property.get_sql_value(value))
        }
      }
//      for (var i in this.identities) {
//        var list = this.identities[i], seed = seeds[i]
//        for (var p in list) {
//          var property = list[p], seed = seeds[i], name = property.name
////          if ()
//          keys.push(name)
//          values.push(property.get_sql_value(seed[name]))
//        }
//      }
      return 'REPLACE INTO ' + this.table_name + ' (`'
        + keys.join('`, `')
        + '`) VALUES ('
        + values.join(', ')
        + ');\n'

//      var sql = "REPLACE INTO %table_name (`%first_key`, `%second_key`) VALUES ("
//        + first_id + ", " + second_id + ")\n;"
//      return Link_Trellis2.populate_sql(sql, this.args);
    }

    private generate_table_name() {
      var temp = MetaHub.map_to_array(this.identities,
        (p)=>  p.parent.get_table_name())
      temp = temp.sort()
      this.table_name = temp.join('_')
    }

    get_key_condition(key:Identity_Key, seed, fill_blanks:boolean = false) {
      if (!seed) {
        console.log('empty key')
      }
      if (typeof seed === 'string' || typeof seed === 'number')
        return this.table_name + '.' + key.name + ' = ' + seed

      if (seed[key.property.name] !== undefined) {
        var value = seed[key.property.name]
        if (typeof value === 'function')
          value == value()
        else if (typeof value === 'string' && value[0] == ':')
          value = value
        else
          value = key.property.get_sql_value(value)

        return this.table_name + '.' + key.name + ' = ' + value
      }
      else if (fill_blanks) {
        return this.table_name + '.' + key.name + ' = ' + key.property.query()
      }

      return null
    }

    get_condition_string(seeds):string {
      return this.get_conditions(seeds).join(' AND ')
    }

    get_identity_conditions(identity:Identity, seed, fill_blanks:boolean = false) {
      var conditions = []
      for (var p in identity.keys) {
        var key = identity.keys[p]
        var condition = this.get_key_condition(key, seed, fill_blanks)
        if (condition)
          conditions.push(condition)
      }

      return conditions
    }

    get_conditions(seeds):string[] {
      var table_name = typeof this.alias === 'string' ? this.alias : this.table_name
      var conditions = []
      for (var i in this.identities) {
        var identity:Identity = this.identities[i], seed = seeds[identity.trellis.name]
        if (!seed) {
          var other_identity:Identity = this.identities[1 - i]
          for (var p in identity.keys) {
            var key = identity.keys[p], other_key = other_identity.keys[p]
            conditions.push(table_name + '.' + key.name + ' = `' + identity.trellis.get_table_name() + '`.' + key.property.name)
          }
        }
        else {
          conditions = conditions.concat(this.get_identity_conditions(identity, seed))
        }
      }

      return conditions
    }

    get_identity_by_trellis(trellis:Trellis):Identity {
      for (var i = 0; i < this.identities.length; ++i) {
        var identity = this.identities[i]
        if (identity.trellis === trellis)
          return identity
      }

      return null
    }

    get_table_declaration():string {
      return typeof this.alias === 'string'
        ? this.table_name + ' ' + this.alias
        : this.table_name
    }
  }

}