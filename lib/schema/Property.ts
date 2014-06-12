/// <reference path="../references.ts"/>

module Ground {

  export enum Relationships {
    none,
    one_to_one,
    one_to_many,
    many_to_many
  }

  export class Property {
    name:string = null
    parent:Trellis = null
    type:string = null
    insert:string = null
    other_property:string = null
  "default"
    other_trellis:Trellis = null
    other_trellis_name:string = null
    is_private:boolean = false
    is_parent:boolean = false
    is_readonly:boolean = false
    is_virtual:boolean = false
    is_composite_sub:boolean = false
    is_unique:boolean = false
    composite_properties:any[] = null
    access:string = 'auto' // 'auto' or 'manual'
    allow_null:boolean

    constructor(name:string, source:IProperty_Source, trellis:Trellis) {
      for (var i in source) {
        if (this.hasOwnProperty(i))
          this[i] = source[i];
      }
      if (source['default'] !== undefined)
        this.default = source['default']

      if (source['allow_null'] !== undefined)
        this.allow_null = source['allow_null']

      if (source.trellis) {
        this.other_trellis_name = source.trellis;
      }

      this.name = name;
      this.parent = trellis;
    }

    initialize_composite_reference(other_trellis:Trellis) {
//      var table = other_trellis.table
//      if (table && table.primary_keys && table.primary_keys.length > 1) {
//        for (var i = 0; i < table.primary_keys.length; ++i) {
//          var key = table.primary_keys[i]
//          var name = other_trellis.name + '_' + key
//          if (key != other_trellis.primary_key) {
//            var other_property = other_trellis.properties[key]
//            var new_property = this.parent.add_property(name, other_property.get_data())
//            new_property.other_property = key
//            new_property.other_trellis_name = this.parent.name
//            new_property.other_trellis = this.parent
//            new_property.is_composite_sub = true
//            this.composite_properties = this.composite_properties || []
//            this.composite_properties.push(new_property)
//          }
//        }
//      }
    }

    fullname():string {
      return this.parent.name + '.' + this.name
    }

    get_allow_null():boolean {
      if (this.allow_null !== undefined)
        return this.allow_null

      var type = this.get_property_type()
      if (type && type.allow_null !== undefined)
        return type.allow_null

      return false
    }

    get_composite() {
      if (this.composite_properties)
        return [ this ].concat(this.composite_properties)

      return [ this ]
    }

    get_data():IProperty_Source {
      var result:IProperty_Source = {
        type: this.type
      };
      if (this.other_trellis_name)
        result.trellis = this.other_trellis_name;

      if (this.is_readonly)
        result.is_readonly = this.is_readonly;

      if (this.is_private)
        result.is_private = this.is_private;

      if (this.insert)
        result.insert = this.insert;

      return result;
    }

    get_default():any {
      var result
      if (this.default == undefined && this.parent.parent && this.parent.parent.properties[this.name])
        result = this.parent.parent.properties[this.name].get_default()
      else
        result = this.default

      if (result === undefined) {
        var type = this.get_property_type()
        if (type)
          result = type.default_value
      }
      return result
    }

    get_field_name():string {
      var field = this.get_field_override();
      if (field) {
        if (field.name)
          return field.name;

        if (field.share)
          return field.share;
      }

      return this.name;
    }

    get_field_override(create_if_missing:boolean = false):IField {
      var table = this.parent.table;
      if (!table) {
        if (!create_if_missing)
          return null;

        table = Table.create_from_trellis(this.parent);
      }

      if (table.properties[this.name] === undefined) {
        if (!create_if_missing)
          return null;

        table.properties[this.name] = {};
      }

      return table.properties[this.name];
    }

    get_field_type() {
      if (this.type == 'reference') {
        var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key]
        return other_primary_property.get_field_type()
      }
      var property_type = this.get_property_type();
      if (!property_type)
        throw new Error(this.name + ' could not find valid field type: ' + this.type);

      return property_type.get_field_type();
    }

//    static get_field_value_sync(value) {
//      if (typeof value === 'string') {
//        value = value.replace(/'/g, "\\'", value);
//        value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
////        console.log('value', value)
//      }
//      else if (value === true)
//        value = 'TRUE';
//      else if (value === false)
//        value = 'FALSE';
//      if (value === null || value === undefined)
//        value = 'NULL';
//
//      return value;
//    }

    get_seed_name():string {
      if (this.is_composite_sub)
        return this.other_property
      else
        return this.name
    }

    get_sql_value(value, type = null, is_reference = false) {
      type = type || this.type
      var property_type = this.parent.ground.property_types[type];
      if (value === undefined || value === null) {
        value = this.get_default()
        if (value === undefined || value === null) {
          if (!this.get_allow_null() && !is_reference)
            throw new Error(this.fullname() + ' does not allow null values.')
        }
      }

      if (property_type && property_type.parent)
        return this.get_sql_value(value, property_type.parent.name, is_reference);

      if (this.parent.primary_key == this.name) {
        value = this.parent.get_identity2(value)
      }

      switch (type) {
        case 'guid':
          if (!value)
            return 'NULL'

          // Strip the guid of hyphens and any invalid characters.  Normalize the case.
          // Also convert from hex to binary within the SQL.
          return "UNHEX('" + value.toUpperCase().replace(/[^A-Z0-9]/g, '') + "')"
        case 'list':
//          throw new Error('Cannot call get_sql_value on a list property')
        case 'reference':
          var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key]
          if (value && typeof value === 'object') {
            value = value[this.other_trellis.primary_key]
            if (!value)
              return null
          }
          return other_primary_property.get_sql_value(value, null, true)
//          if (typeof value === 'object') {
//            value = value[this.other_trellis.primary_key]
//          }
//          return value || 'NULL';
        case 'int':
          if (!value)
            return 0

          if (typeof value === 'string' && !value.match(/^-?\d+$/))
            throw new Error(this.fullname() + ' expected an integer but recieved: ' + value)

          return Math.round(value)
        case 'string':
        case 'text':
          if (!value)
            return "''"

          if (typeof value !== 'string')
            value = value.toString()

          value = value.replace(/'/g, "\\'", value);
          return "'" + value.replace(/[\r\n]+/, "\n") + "'";
        case 'bool':
          return value ? 'TRUE' : 'FALSE'
        case 'float':
        case 'double':
          if (!value)
            return 0

          var num = parseFloat(value)
          if (num == NaN)
            throw new Error(this.fullname() + ' expected an integer but recieved: ' + value)

          return num
        case 'money':
          if (typeof value !== 'number')
            return parseFloat(value.toString());
      }

      throw new Error('Ground is not configured to process property types of ' + type + ' (' + this.type + ')')
    }

    get_type():string {
      if (this.type == 'reference' || this.type == 'list') {
//        var other_property = this.get_other_property()
//        if (other_property)
//          return other_property.type

        return this.other_trellis.properties[this.other_trellis.primary_key].type
      }

      return this.type
    }

//    get_field_value(value, as_service:boolean = false, update:boolean = false) {
//      if (typeof value === 'string')
//        value = value.replace(/'/g, "\\'", value);
//
//      if (value === true)
//        value = 'TRUE';
//      else if (value === false)
//        value = 'FALSE';
//      if (value === null || value === undefined)
//        value = 'NULL';
//      else if (this.type == 'string' || this.type == 'text' || this.type == 'guid') {
//        value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
//      }
//      else if (this.type == 'reference') {
//        if (typeof value !== 'object') {
//          var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key]
//          value = other_primary_property.get_field_value(value, as_service, update)
//        }
//      }
//
//      return value
//    }

    get_other_id(entity) {
      var value = entity[this.other_trellis.primary_key];
      if (value === undefined)
        value = null;

      return value;
    }

    get_other_property(create_if_none:boolean = false):Property {
      var property;
      if (this.other_property) {
        var properties = this.other_trellis.get_all_properties()
        var other_property = properties[this.other_property]
        if (!other_property) {
          throw new Error('Invalid other property in ' + this.get_field_name() + ": "
            + this.other_trellis.name + '.' + this.other_property + ' does not exist.')

        }
        return other_property
      }
      else {
        if (!this.other_trellis) {
          if (create_if_none)
            throw new Error("Attempt to get other property for " + this.get_field_name() + " but its other_trellis is null.");

          return null
        }

        for (var name in this.other_trellis.properties) {
          property = this.other_trellis.properties[name];
          if (property.other_trellis === this.parent) {
            return property;
          }
        }
      }

      if (this.other_trellis === this.parent) {
        if (create_if_none)
          return this

        return null
      }

      if (!create_if_none)
        return null

      // If there is no existing connection defined in this trellis, create a dummy
      // connection and assume that it is a list.  This means that implicit connections
      // are either one-to-many or many-to-many, never one-to-one.
      var attributes:IProperty_Source = <IProperty_Source>{}
      attributes.type = 'list'
      attributes.is_virtual = true
      attributes.trellis = this.parent.name
      var result = new Property(this.other_trellis.name, attributes, this.other_trellis)
      result.other_trellis = this.parent
      return result
    }

    get_property_type():Property_Type {
      var types = this.parent.ground.property_types;
      if (types[this.type] !== undefined)
        return types[this.type];

      return null;
    }

    get_referenced_trellis():Trellis {
      return this.other_trellis;
    }

    get_relationship():Relationships {
      if (this.type != 'list' && this.type != 'reference')
        return Relationships.none

      var field = this.get_field_override();
      if (field && field.relationship) {
        return Relationships[field.relationship];
      }

      var other_property = this.get_other_property();
      if (!other_property) {
        if (this.type == 'list')
          return Relationships.one_to_many
        else
          return Relationships.one_to_one
      }

//        throw new Error(this.parent.name + '.' + this.name + ' does not have a reciprocal reference.');

      if (this.type == 'list') {
        if (other_property.type == 'list')
          return Relationships.many_to_many;
        else
          return Relationships.one_to_many;
      }
      return Relationships.one_to_one;
    }

    get_field_query():string {
      var field_name = this.get_field_name()
      var sql = this.query()
      var type = this.get_type()
      if (type == 'guid')
        sql = "INSERT(INSERT(INSERT(INSERT(HEX(" + sql + ")"
          + ",9,0,'-')"
          + ",14,0,'-')"
          + ",19,0,'-')"
          + ",24,0,'-') AS `" + this.name + '`'
//      sql = 'HEX(' + sql + ') AS `' + this.name + '`'
      else if (field_name != this.name)
        sql += ' AS `' + this.name + '`'

      return sql
    }

    query():string {
      return '`' + this.parent.get_table_name() + '`.' + this.get_field_name()
    }

    export_schema():IProperty_Source {
      var result:IProperty_Source = {
        type: this.type
      }
      if (this.other_trellis)
        result.trellis = this.other_trellis.name

      if (this.is_virtual)
        result.is_virtual = true

      if (this.insert)
        result.insert = this.insert

      if (this.is_readonly)
        result.is_readonly = true

      if (this.default !== undefined)
        result['default'] = this.default

      if (this.allow_null)
        result.allow_null = true

      return result
    }

//    get_referenced_trellis():Trellis {
//      var other = this.parent.ground.trellises[this.trellis];
//      if (!other)
//        throw new Error('Could not find reference to property ' + this.name + ' for ' + this.trellis + '.');
//
//      return other;
//
//    }
  }
}