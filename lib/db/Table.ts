/// <reference path="../references.ts"/>

module Ground {
  export interface IField {
    relationship?:string
    name:string
    share?:string
    other_table?:string
    other_field?:string
  }

  export enum Link_Field_Type {
    identity,
    reference
  }

  export class Link_Field {
    name:string
    parent:Table
    other_table:Table
    type:Link_Field_Type
    other_link:Link_Field
    field:IField
    property:Property

    constructor(name:string, parent:Table, other_table:Table, type:Link_Field_Type) {
      this.name = name
      this.parent = parent
      this.other_table = other_table
      this.type = type
    }
  }

  export class Table {
    name:string
    properties = {}
    indexes:any[]
    ground:Core
    db_name:string
    trellis:Trellis
    primary_keys:any[]
    query:string
    links = {}

    constructor(name:string, ground:Core) {
      this.name = name;
      this.ground = ground;
    }

    connect_trellis(trellis:Trellis) {
      this.trellis = trellis;
      trellis.table = this;
    }

    static create_from_trellis(trellis:Trellis, ground:Core = null):Table {
      if (trellis.table)
        return trellis.table;

      ground = ground || trellis.ground;

      var table = new Table(trellis.get_table_name(), ground);
      table.connect_trellis(trellis);
      return table;
    }

    static get_other_table(property:Property):Table {
      var ground = property.parent.ground
      var name = Table.get_other_table_name(property)
      return ground.tables[name]
    }

    static get_other_table_name(property:Property):string {
      var field = property.get_field_override()
      if (field && field.other_table)
        return field.other_table

      if (property.get_relationship() === Relationships.many_to_many)
        return Cross_Trellis.generate_name(property.parent, property.other_trellis)

      return property.other_trellis.name
    }

    create_link(property:Property) {

      var other_table = Table.get_other_table(property)
      if (!other_table)
        throw new Error('Could not find other table for ' + property.fullname())

      var type = property.type == 'reference'
        ? Link_Field_Type.reference
        : Link_Field_Type.identity

      var link = new Link_Field(
        property.name,
        this,
        other_table,
        type
      )

      link.property = property

      if (this.properties[link.name])
        link.field = this.properties[link.name]

      var other_link
      if (!other_table.trellis) {
        // other_table must be a cross-table
        var other_field_name = link.field && link.field.other_field
          ? link.field.other_field
          : property.parent.name // By default cross-table links are the name of the trellis they point to

        other_link = new Link_Field(
          property.name,
          other_table,
          this,
          Link_Field_Type.reference // Cross-table links are always references
        )

        other_table.links[other_link.name]= other_link
      }
      else {
        var other_field_name = link.field && link.field.other_field
          ? link.field.other_field
          : property.get_other_property(true).name

        // I'm assuming that if the other link is currently null,
        // it will be initialized later and at that time
        // the cross references will be assigned.
        other_link = other_table.links[other_field_name] || null
      }

      if (other_link) {
        link.other_link = other_link
        other_link.other_link = link
      }

      this.links[link.name] = link
    }

    create_sql(ground:Core) {
      var fields = [];
      for (var name in this.properties) {
        var property = this.properties[name]

        var field = {
          name: property.name || name,
          type: ground.get_base_property_type(property.type).field_type,
          default: undefined
        }

        if (property.default !== undefined)
          field.default = property.default;

        fields.push(field);
      }

      return Table.create_sql_from_array(this.name, fields, this.primary_keys, this.indexes);
    }

    static create_sql_from_array(table_name:string, source:any[], primary_keys = [], indexes = []):string {
      var fields = MetaHub.map_to_array(source, (field, index)=> {
        var name = field.name || index;
        var type = field.type;

        if (!type) {
          console.log('source', table_name, source)
          throw new Error('Field ' + name + ' is missing a type.');
        }

        var auto_increment =
          primary_keys.indexOf(name) > -1
            && type.search(/INT/) > -1
            && primary_keys[0] == name

        var field_sql = '`' + name + '` ' + type;
        if (auto_increment)
          field_sql += ' AUTO_INCREMENT';

        if (field.allow_null === false) {
          field_sql += ' NOT NULL'
        }

        // auto_increment fields should not have a default
        if (!auto_increment && field.default !== undefined)
          field_sql += ' DEFAULT ' + Table.format_value(field.default);

        return field_sql;
      });

      // Currently can't create a table without fields.  Seems reasonable enough.
      if (fields.length == 0) {
        if (source.length > 0)
          throw new Error('None of the field arguments for creating ' + table_name + ' have a type.');
        else
          throw new Error('Cannot creat a table without fields: ' + table_name + '.');
      }

      var primary_fields = MetaHub.map_to_array(primary_keys, (key) => '`' + key + '`');
      fields.push('PRIMARY KEY (' + primary_fields.join(', ') + ")\n");
      fields = fields.concat(indexes.map((index) => Table.generate_index_sql(index)))
      var sql = 'CREATE TABLE IF NOT EXISTS `' + table_name + "` (\n";
      sql += fields.join(",\n") + "\n";
      sql += ");\n";
      return sql;
    }

    create_sql_from_trellis(trellis:Trellis):string {
      if (!trellis) {
        if (!this.trellis)
          throw new Error('No valid trellis to generate sql from.');

        trellis = this.trellis;
      }

      var indexes = this.indexes ? [].concat(this.indexes) : []
      var core_properties = trellis.get_core_properties();
      if (Object.keys(core_properties).length === 0)
        throw new Error('Cannot create a table for ' + trellis.name + '. It does not have any core properties.');

      var fields = [];
      for (var name in core_properties) {
        var property = core_properties[name];
        var field_test = this.properties[property.name];
        if (property.is_virtual)
          continue

        // Don't duplicate shared fields.
        if (field_test && field_test.share)
          continue;

        var allow_null = property.get_allow_null()
        // If a property is set to allow nulls, it should default to null unless a default
        // is directly set for that property.
        // If a property is set to not allow nulls, try to use the property default, and if that
        // isn't set, use the property type default as a fallback.
        var default_value
        if (allow_null) {
          default_value = property.default !== undefined ? property.default : null
        }
        else {
          default_value = property.get_default()

          // If allow_null is false, then null is an invalid default value
          if (default_value === null)
            default_value = undefined
        }

        var field = {
          name: property.get_field_name(),
          type: property.get_field_type(),
          "default": default_value,
          allow_null: allow_null
        };

        fields.push(field)

        if (property.is_unique) {
          indexes.push({
            name: name + '_unique_index',
            fields: [ name ],
            unique: true
          })
        }
      }

      var primary_keys = this.get_primary_keys(trellis);

      return Table.create_sql_from_array(this.name, fields, primary_keys, indexes);
    }

    private get_primary_keys(trellis:Trellis):string[] {

      // Inherit primary keys
      if (!this.primary_keys && trellis.parent) {
        var parent = trellis.parent;
        do {
          if (parent.table && parent.table.primary_keys) {
            return parent.table.primary_keys;
          }
        }
        while (parent = parent.parent)
      }

      if (this.primary_keys && this.primary_keys.length > 0) {
        return this.primary_keys.map((name) => {
          if (!trellis.properties[name])
            throw new Error('Error creating ' + trellis.name + '; it does not have a primary key named ' + name + '.');

          return trellis.properties[name].get_field_name();
        });
      }

      return [ trellis.properties[trellis.primary_key].get_field_name() ];
    }

    static format_value(value) {
      if (typeof value === 'string')
        return "'" + value + "'";

      if (value === null)
        return 'NULL';

      if (value === true)
        return 'TRUE';

      if (value === false)
        return 'FALSE';

      return value;
    }

    static generate_index_sql(index) {
      var name = index.name || ''
      var name_string, index_fields = index.fields.join('`, `');
      var result = '';

      if (index.unique) {
        result += 'UNIQUE ';
        name_string = '';
      }
      else {
        name_string = '`' + name + '`';
      }

      result += "KEY " + name_string + ' (`' + index_fields + "`)\n";
      return result;
    }

    load_from_schema(source) {
      var name = this.name;
      MetaHub.extend(this, source);
      if (this.ground.trellises[name]) {
        this.trellis = this.ground.trellises[name];
        this.trellis.table = this;
        if (!source.name)
          this.name = this.trellis.name + 's';
      }
    }
  }
}