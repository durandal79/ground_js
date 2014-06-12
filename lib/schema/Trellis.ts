/// <reference path="../references.ts"/>

module Ground {

  export interface ITrellis {

  }

  export class Trellis implements ITrellis {
    parent:Trellis = null
    ground:Core
    table:Table = null
    name:string = null
    primary_key:string = 'id'
    is_virtual:boolean = false

    // Property objects that are specific to this trellis and not inherited from a parent trellis
    properties:{
      [name: string]: Property
    } = {}

    // Every property including inherited properties
    all_properties = {}

    // If a trellis has one or more properties configured to insert the trellis name, the first of
    // those are stored here
    type_property:Property

    constructor(name:string, ground:Core) {
      this.ground = ground;
      this.name = name;
    }

    add_property(name:string, source):Property {
      var property = new Property(name, source, this)
      this.properties[name] = property
      this.all_properties[name] = property
      if (property.insert == 'trellis' && !this.type_property)
        this.type_property = property

      return property;
    }

    check_primary_key() {
      if (!this.properties[this.primary_key] && this.parent) {
        var property = this.parent.properties[this.parent.primary_key];
        this.properties[this.primary_key] = new Property(this.primary_key, property.get_data(), this);
      }
    }

    clone_property(property_name:string, target_trellis:Trellis) {
      if (this.properties[property_name] === undefined)
        throw new Error(this.name + ' does not have a property named ' + property_name + '.');

      target_trellis.add_property(property_name, this.properties[property_name]);
    }

    get_all_links(filter:(property:Property)=>boolean = null) {
      var result = {};
      var properties = this.get_all_properties();
      for (var name in properties) {
        var property = properties[name];
        if (property.other_trellis && (!filter || filter(property)))
          result[property.name] = property;
      }

      return result;
    }

    get_all_properties() {
      var result = {}
      var tree = this.get_tree();
      for (var i = 0; i < tree.length; ++i) {
        var trellis = tree[i];
        for (var name in trellis.properties) {
          var property = trellis.properties[name];
          result[property.name] = property;
        }
      }
      return result;
    }

    get_property(name:string):Property {
      var properties = this.get_all_properties()
      var property = properties[name]
      if (!property)
        throw new Error('Trellis ' + this.name + ' does not contain a property named ' + name + '.')

      return property
    }

    get_core_properties() {
      var result = {}
      for (var i in this.properties) {
        var property = this.properties[i];
        if (property.type != 'list')
          result[i] = property;
      }

      return result;
    }

    get_id(source) {
      if (source && typeof source === 'object')
        return source[this.primary_key];

      return source;
    }

    get_identity(seed) {
      var composite = this.properties[this.primary_key].get_composite()
        .filter((x)=> seed[x.name] !== undefined)

//      if (composite.length == 1)
//        return seed[composite[0].name]

      var result = {}
      for (var i in composite) {
        var c = composite[i]
        result[c.name] = seed[c.name]
      }

      return result;
    }

    get_identity2(value) {
      if (typeof value == 'object')
        return value[this.primary_key]

      return value
    }

    get_ancestor_join(other:Trellis):string {
//      if (!this.parent)
//        return null;

      var conditions = this.get_primary_keys().map((property)=>
          property.query() +
            ' = ' + other.properties[property.name].query()
      )

      return 'JOIN  ' + other.get_table_query() +
        ' ON ' + conditions.join(' AND ');
    }

    get_links():Property[] {
      var result:Property[] = [];
      for (var name in this.properties) {
        var property = this.properties[name];
        if (property.other_trellis)
          result.push(property);
      }
      return result;
    }

    get_primary_keys() {
      if (this.table && this.table.primary_keys) {
        var result = []
        for (var i in this.table.primary_keys) {
          var key = this.table.primary_keys[i]
          result.push(this.properties[key])
        }
        return result
      }

      return [ this.properties[this.primary_key] ]
    }

    get_primary_property():Property {
      return this.properties[this.primary_key]
    }

    get_reference_property(other_trellis:Trellis):Property {
      var properties = this.get_all_properties()
      for (var i in properties) {
        var property = properties[i]
        if (property.other_trellis === other_trellis)
          return property
      }

      return null
    }

    get_root_table():Table {
      if (this.parent && this.ground.tables[this.parent.name])
        return this.parent.get_root_table()

      return this.ground.tables[this.name]
    }

    get_table_name():string {
      if (this.is_virtual) {
        if (this.parent) {
          return this.parent.get_table_name();
        }
//        else {
//          throw new Error('Cannot query trellis ' + this.name + ' since it is virtual and has no parent');
//        }
      }
      if (this.table) {
        if (this.table.db_name)
          return this.table.db_name + '.' + this.table.name;
        else
          return this.table.name;
      }

      return this.name + 's';
    }

    get_table_query():string {
      if (this.table && this.table.query)
        return this.table.query;

      return '`' + this.get_table_name() + '`'
    }

    get_tree():Trellis[] {
      var trellis = this;
      var tree:Trellis[] = [];

      do {
        tree.unshift(trellis)
      }
      while (trellis = trellis.parent);

      return tree;
    }

    initialize(all) {
      if (typeof this.parent === 'string') {
        if (!all[this.parent])
          throw new Error(this.name + ' references a parent that does not exist: ' + this.parent + '.')

        this.set_parent(all[this.parent])
        this.check_primary_key()
      }

      for (var j in this.properties) {
        var property:Property = this.properties[j]
        if (property.other_trellis_name) {
          var other_trellis = property.other_trellis = all[property.other_trellis_name]
          if (!other_trellis)
            throw new Error('Cannot find referenced trellis for ' + this.name + '.' + property.name + ': ' + property.other_trellis_name + '.')

          property.initialize_composite_reference(other_trellis)
        }
      }
    }

    load_from_object(source:ITrellis_Source) {
      for (var name in source) {
        if (name != 'name' && name != 'properties' && this[name] !== undefined && source[name] !== undefined) {
          this[name] = source[name];
        }
      }

      for (name in source.properties) {
        this.add_property(name, source.properties[name]);
      }
    }

    query():string {
      return this.get_table_query() + '.' + this.properties[this.primary_key].get_field_name()
    }

    query_primary_key():string {
      return this.query()
    }

    sanitize_property(property) {
      if (typeof property === 'string') {
        var properties = this.get_all_properties();
        if (properties[property] === undefined)
          throw new Error(this.name + ' does not contain a property named ' + property + '.');

        return properties[property];
      }

      return property;
    }

    set_parent(parent:Trellis) {
      this.parent = parent;

      if (!parent.primary_key)
        throw new Error(parent.name + ' needs a primary key when being inherited by ' + this.name + '.');

      var keys;
//      console.log(this.name, parent.name)
      if (parent.table && parent.table.primary_keys) {
        keys = parent.table.primary_keys;
        if (!this.table)
          this.table = Table.create_from_trellis(this)

        this.table.primary_keys = keys
//        console.log('table', this.table)
      }
      else {
        keys = [ parent.primary_key ]
      }

      for (var i = 0; i < keys.length; ++i) {
        parent.clone_property(keys[i], this);
      }
      this.primary_key = parent.primary_key;
    }

    private seed_has_properties(seed, properties:string[]):boolean {
      for (var i in properties) {
        var name = properties[i]
        if (seed[name] === undefined)
          return false
      }

      return true
    }

    assure_properties(seed, required_properties:string[]):Promise {
      if (this.seed_has_properties(seed, required_properties)) {
        return when.resolve(seed)
      }

      var query = this.ground.create_query(this.name)
      query.add_key_filter(this.get_identity2(seed))
      query.extend({
        properties: required_properties
      })
      return query.run_single()
    }

    export_schema():ITrellis_Source {
      var result:ITrellis_Source = {}
      if (this.parent)
        result.parent = this.parent.name
      else if (this.primary_key != 'id')
        result.primary_key = this.primary_key

      if (this.is_virtual)
        result.is_virtual = true

      result.properties = MetaHub.map(this.properties, (property) => property.export_schema())

      return result
    }
  }
}
