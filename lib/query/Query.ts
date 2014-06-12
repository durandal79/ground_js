/// <reference path="../references.ts"/>

// !!! THE Query CLASS IS DEPRECATED.  It was broken into multiple smaller classes. !!!

module Ground {

  interface ILink {
    other:Trellis
    property:Property
  }

  export interface IService_Response {
    objects:any[]
  }

  export interface Query_Wrapper {
    start:string
    end:string
  }

  export interface Property_Query_Source {
    name:string
    filters?:Query_Filter_Source[]
    sorts?:Query_Sort[]
    expansions?:string[]
    properties?:any[]
    subqueries?
    pager?
  }

  export interface External_Query_Source extends Property_Query_Source {
    trellis:string;
    map?
    type?:string
    queries?:External_Query_Source[]
  }

  export class Query {
    ground:Core;
    joins:string[] = []
    post_clauses:any[] = []
    limit:string
    trellis:Trellis
    db:Database
    include_links:boolean = true
    fields:string[] = []
    base_path:string
    arguments = {}
    expansions:string[] = []
    wrappers:Query_Wrapper[] = []
    private row_cache
    type:string = 'query'
    properties
    source:External_Query_Source
    sorts:Query_Sort[] = []

    filters:string[] = []
    run_stack

    property_filters:Query_Filter_Source[] = []

    public static operators = [
      '=',
      'LIKE',
      '!='
    ]

    private links:ILink[] = []

    constructor(trellis:Trellis, base_path:string = null) {
      this.trellis = trellis;
      this.ground = trellis.ground;
      this.db = this.ground.db;
      if (base_path)
        this.base_path = base_path;
      else
        this.base_path = this.trellis.name;
    }

    add_arguments(args) {
      for (var a in args) {
        this.arguments[a] = args[a];
      }
    }

    add_filter(clause:string, arguments:any[] = null) {
      this.filters.push(clause);
      if (arguments)
        this.add_arguments(arguments);
    }

    add_property_filter(property:string, value = null, operator:string = '=') {
      if (Query.operators.indexOf(operator) === -1)
        throw new Error("Invalid operator: '" + operator + "'.")

      if (value === null || value === undefined)
        throw new Error('Cannot add property filter where value is null; property= ' + this.trellis.name + '.' + property + '.')

      this.property_filters.push({
        property: property,
        value: value,
        operator: operator
      })
    }

    add_key_filter(value) {
      this.add_property_filter(this.trellis.primary_key, value)
//      this.filters.push(this.trellis.query_primary_key() + ' = :primary_key');
//      this.add_arguments({ ':primary_key': value });
    }

    add_field(clause:string, arguments = null) {
      this.fields.push(clause);
      if (arguments) {
        this.add_arguments(arguments);
      }
    }

    add_join(clause:string, arguments = null) {
      this.joins.push(clause);
      if (arguments) {
        this.add_arguments(arguments);
      }
    }

    add_post(clause:string, arguments = null) {
      this.post_clauses.push(clause);
      if (arguments) {
        this.add_arguments(arguments);
      }
    }

    add_expansion(clause) {
      this.expansions.push(clause);
    }

    add_link(property) {
      property = this.trellis.sanitize_property(property);
      if (this.links[property.name])
        throw new Error(property.name + ' added twice to query.');

      var link:ILink = {
        other: property.get_referenced_trellis(),
        property: property
      };

      this.links[property.name] = link;
    }

    add_sort(sort:Query_Sort) {
      for (var i = 0; i < this.sorts.length; ++i) {
        if (this.sorts[i].property == sort.property) {
          this.sorts.splice(i, 1)
          break
        }
      }

      this.sorts.push(sort)
    }

    static process_sorts(sorts:Query_Sort[], trellis:Trellis):string {
      if (sorts.length == 0)
        return ''

      if (trellis)
        var properties = trellis.get_all_properties()

      var items = sorts.map((sort)=> {
        var sql
        if (trellis) {
          if (!properties[sort.property])
            throw new Error(trellis.name + ' does not contain sort property: ' + sort.property)

          sql = properties[sort.property].query()
        }
        else {
          sql = sort.property
        }

        if (typeof sort.dir === 'string') {
          var dir = sort.dir.toUpperCase()
          if (dir == 'ASC')
            sql += ' ASC'
          else if (dir == 'DESC')
            sql += ' DESC'
        }

        return 'ORDER BY ' + sql
      })

      return items.join(', ')
    }

    add_wrapper(wrapper:Query_Wrapper) {
      this.wrappers.push(wrapper)
    }

    generate_pager(offset:number = 0, limit:number = 0):string {
      offset = Math.round(offset);
      limit = Math.round(limit);
      if (!offset) {
        if (!limit)
          return '';
        else
          return ' LIMIT ' + limit;
      }
      else {
        if (!limit)
          limit = 18446744073709551615;

        return ' LIMIT ' + offset + ', ' + limit;
      }
    }

    generate_sql(properties):string {
      var filters
      var data = this.get_fields_and_joins(properties)
      var data2 = this.process_property_filters()
      var fields = data.fields.concat(this.fields)
      var joins = data.joins.concat(this.joins, data2.joins)
      var args = MetaHub.concat(this.arguments, data2.arguments)
      if (data2.filters)
        filters = this.filters.concat(data2.filters)
      else
        filters = this.filters

      if (fields.length == 0)
        throw new Error('No authorized fields found for trellis ' + this.trellis.name + '.');

      var sql = 'SELECT '
      sql += fields.join(",\n")
      sql += "\nFROM `" + this.trellis.get_table_name() + '`'
      if (joins.length > 0)
        sql += "\n" + joins.join("\n")

      if (filters.length > 0)
        sql += "\nWHERE " + filters.join(" AND ")

      if (this.sorts.length > 0)
        sql += ' ' + Query.process_sorts(this.sorts, this.trellis)

      if (this.post_clauses.length > 0)
        sql += " " + this.post_clauses.join(" ")

      // Temporary fix to simulate prepared statements.  Banking on the mysql module supporting them soon.

//      if (sql.indexOf(':') > -1) {
//        throw new Error('Missing prepared statement argument:' + sql)
//      }

      for (var i = 0; i < this.wrappers.length; ++i) {
        var wrapper = this.wrappers[i]
        sql = wrapper.start + sql + wrapper.end
      }

      for (var pattern in args) {
        var value = args[pattern];
//        sql = sql.replace(new RegExp(pattern), Property.get_sql_value(value));
        sql = sql.replace(new RegExp(pattern), value);
      }

      return sql;
    }

    get_fields_and_joins(properties:{ [name: string]: Property
    }, include_primary_key:boolean = true):Internal_Query_Source {
      var name, fields:string[] = [];
      var trellises = {};
      for (name in properties) {
        var property = properties[name];
        // Virtual properties aren't saved to the database
        // Useful when you define custom serialization hooks
        if (property.type == 'list' || property.is_virtual)
          continue;

        if (property.name != this.trellis.primary_key || include_primary_key) {
          var sql = property.get_field_query()
          fields.push(sql);
          if (property.parent.name != this.trellis.name)
            trellises[property.parent.name] = property.parent
        }
      }
      var joins = [];
      for (name in trellises) {
        var trellis = trellises[name];
        var join = this.trellis.get_ancestor_join(trellis);
        if (join)
          joins.push(join);
      }

      return {
        fields: fields,
        joins: joins
      }
    }

    get_primary_key_value() {
      var filters = this.property_filters.filter((filter)=>filter.property == this.trellis.primary_key)
      if (filters.length > 0)
        return filters[0].value

      return undefined
    }

    static generate_property_join(property:Property, seeds) {
      var join = Link_Trellis.create_from_property(property);
      return join.generate_join(seeds);
    }

    create_sub_query(trellis:Trellis, property:Property):Query {
      var query = new Query(trellis, this.get_path(property.name));
      query.include_links = false;
      query.expansions = this.expansions;
      if (typeof this.properties === 'object'
        && typeof this.properties[property.name] === 'object') {
        query.extend(this.properties[property.name])
      }

      return query
    }

    get_many_list(seed, property:Property, relationship:Relationships):Promise {
      var id = seed[property.parent.primary_key]
      if (id === undefined || id === null)
        throw new Error('Cannot get many-to-many list when seed id is null.')

      var other_property = property.get_other_property();
      if (!other_property)
        return when.resolve()

      var query = this.create_sub_query(other_property.parent, property);
      if (relationship === Relationships.many_to_many) {
        var seeds = {}
        seeds[this.trellis.name] = seed
        query.add_join(Query.generate_property_join(property, seeds))
      }
      else if (relationship === Relationships.one_to_many)
        query.add_property_filter(other_property.name, id)

      return query.run();
    }

    get_path(...args:string[]):string {
      var items:string[] = [];
      if (this.base_path)
        items.push(this.base_path);

      items = items.concat(args);
      return items.join('/');
    }

    get_reference_object(row, property:Property) {
      var query = this.create_sub_query(property.other_trellis, property)
      var value = row[property.name]
      if (!value)
        return when.resolve(value)

      query.add_key_filter(value);
      return query.run()
        .then((rows) => rows[0])
    }

    has_expansion(path:string):boolean {
      for (var i = 0; i < this.expansions.length; ++i) {
        var expansion = this.expansions[i];
        // Check if the expansion is a regex
        if (expansion[0] == '/' && expansion[expansion.length - 1] == '/') {
          if (path.match(new RegExp(expansion)))
            return true;
        }
        else {
          if (path == expansion)
            return true;
        }
      }

      return false;
    }

    process_row(row):Promise {
      var name, property

      var properties = this.trellis.get_core_properties()
      for (name in properties) {
        property = properties[name]
        var value = row[property.name]
        if (value === undefined)
          continue

        row[property.name] = this.ground.convert_value(value, property.type)
      }

      var links = this.trellis.get_all_links((p)=> !p.is_virtual);

      var promises = MetaHub.map_to_array(links, (property, name) => {
        if (property.is_composite_sub)
          return null

        var path = this.get_path(property.name)

        if (this.include_links || this.has_expansion(path)) {
          return this.query_link_property(row, property).then((value) => {
            row[name] = value
            return row
          })
        }

        return null
      })

      return when.all(promises)
        .then(()=> this.ground.invoke(this.trellis.name + '.queried', row, this))
        .then(()=> row)
    }

    query_link_property(seed, property):Promise {
      var relationship = property.get_relationship()

      switch (relationship) {
        case Relationships.one_to_one:
          return this.get_reference_object(seed, property)
          break
        case Relationships.one_to_many:
        case Relationships.many_to_many:
          return this.get_many_list(seed, property, relationship)
          break
      }

      throw new Error('Could not find relationship: ' + relationship + '.')
    }

    process_property_filter(filter):Internal_Query_Source {
      var result = {
        filters: [],
        arguments: {},
        joins: []
      }
      var property = this.trellis.sanitize_property(filter.property);
      var value = filter.value;

      var placeholder = ':' + property.name + '_filter';
//      if (value === 'null' && property.type != 'string') {
//        result.filters.push(property.query() + ' IS NULL');
//        return result;
//      }

      if (value !== null)
        value = this.ground.convert_value(value, property.type);

      if (value === null || value === undefined) {
        throw new Error('Query property filter ' + placeholder + ' is null.')
      }

      if (property.get_relationship() == Relationships.many_to_many) {
//        throw new Error('Filtering many to many will need to be rewritten for the new Link_Trellis.');
        var join_seed = {}
        join_seed[property.other_trellis.name] = ':' + property.name + '_filter'

        result.joins.push(Query.generate_property_join(property, join_seed));
      }
      else {
        if (filter.operator.toLowerCase() == 'like') {
          result.filters.push(property.query() + ' LIKE ' + placeholder);
          if (value !== null)
            value = '%' + value + '%';
        }
        else {
          result.filters.push(property.query() + ' = ' + placeholder);
        }
      }

      if (value !== null) {
        value = property.get_sql_value(value)
        result.arguments[placeholder] = value;
      }

      return result;
    }

    process_property_filters():Internal_Query_Source {
      var result = {}
      for (var i in this.property_filters) {
        var filter = this.property_filters[i]
        MetaHub.extend(result, this.process_property_filter(filter))
      }
      return result
    }

    extend(source:External_Query_Source) {
      var i

      this.source = source

      if (source.filters) {
        for (i = 0; i < source.filters.length; ++i) {
          var filter = source.filters[i]
          this.add_property_filter(filter.path || filter.property, filter.value, filter.operator)
        }
      }

      if (source.sorts) {
        for (i = 0; i < source.sorts.length; ++i) {
          this.add_sort(source.sorts[i])
        }
      }

      if (source.properties) {
        var properties = this.trellis.get_all_properties()
        this.properties = {}
        for (var i in source.properties) {
          var property = source.properties[i]
          if (typeof property == 'string') {
            if (!properties[property])
              throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + property + '.')

            this.properties[property] = {
            }
          }
          else {
            if (!properties[property.name])
              throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + property.name + '.')

            if (property)
              this.properties[property.name] = property
          }
        }

        var identities = [ this.trellis.properties[this.trellis.primary_key] ]
        if (identities[0].composite_properties && identities[0].composite_properties.length > 0) {
          identities = identities.concat(identities[0].composite_properties)
        }

        for (var k in identities) {
          var identity = identities[k]
          if (!this.properties[identity.name])
            this.properties[identity.name] = {}
        }
      }
    }

    run_core():Promise {
      if (this.row_cache)
        return when.resolve(this.row_cache)

      var properties
      if (this.properties && Object.keys(this.properties).length > 0) {
        properties = this.trellis.get_all_properties()
        properties = MetaHub.map(this.properties, (property, key)=> properties[key])
      }
      else {
        properties = this.trellis.get_all_properties()
      }

      var tree = this.trellis.get_tree()
      var promises = tree.map((trellis:Trellis) => this.ground.invoke(trellis.name + '.query', this))

      return when.all(promises)
        .then(()=> {
          var sql = this.generate_sql(properties);
          sql = sql.replace(/\r/g, "\n");
          if (this.ground.log_queries)
            console.log('query', sql);

//          var args = MetaHub.values(this.arguments).concat(args);
          return this.db.query(sql)
            .then((rows)=> {
              this.row_cache = rows
              return rows
            })
        })
    }

    run():Promise {
      if (this.ground.log_queries) {
        var temp = new Error()
        this.run_stack = temp['stack']
      }

      var properties = this.trellis.get_all_properties();
      return this.run_core()
        .then((rows) => when.all(rows.map((row) => this.process_row(row))))
    }

    // The cross_property parameter is intended to override the normal trellis with a cross-table;
    // useful for optimizing joins.
    static get_identity_sql(property:Property, cross_property:Property = null) {
      if (cross_property) {
        var join = Link_Trellis.create_from_property(cross_property)
        var identity = join.get_identity_by_trellis(cross_property.other_trellis)
        return join.table_name + '.' + identity.name
      }
      else if (property.type == 'list') {
        var trellis = property.parent
//          return trellis.properties[trellis.primary_key].query()
        return trellis.query_primary_key()
      }
      else {
        return property.query()
      }
    }

    // The cross_property parameter is intended to override the normal trellis with a cross-table;
    // useful for optimizing joins.
    static generate_join(property:Property, cross_property:Property = null):string {
      var other_property = property.get_other_property(true)
//      if (!other_property)
//        throw new Error('Could not find other property of ' + property.query())

      var other = property.other_trellis

      var relationship = property.get_relationship()

      switch (relationship) {
        case Relationships.one_to_one:
        case Relationships.one_to_many:
          var first_part, second_part
          if (property.type == 'list')
            first_part = other_property.query()
          else
            first_part = other.query_primary_key()

          second_part = Query.get_identity_sql(property, cross_property)

          return 'JOIN ' + other.get_table_query() +
            '\nON ' + first_part + ' = ' + second_part + '\n'

        case Relationships.many_to_many:
          var seeds = {}
//          seeds[this.trellis.name] = seed
          var join = Link_Trellis.create_from_property(property)
          var identity = join.get_identity_by_trellis(property.parent)
          return 'JOIN ' + join.table_name + '\nON '
            + join.get_identity_conditions(identity, {}, true).join(' AND ') + '\n'
//          return Query.generate_property_join(property, seeds)
      }
    }

    static query_path(path:string, args:any[], ground:Core):Promise {
      var sql = Query.follow_path(path, args, ground)
//      console.log('query_path', sql)
      return ground.db.query_single(sql)
    }

    // Returns a sql query string
    static follow_path(path, args:any[], ground:Core):string {
      var parts = Ground.path_to_array(path)
      var sql = 'SELECT COUNT(*) AS total\n'

//      var parts = Query.process_tokens(tokens, args, ground)
      var cross_property:Property = null, first_trellis

      var trellis:Trellis = first_trellis = ground.sanitize_trellis_argument(parts[0])
      sql += 'FROM `' + trellis.get_table_name() + '`\n'

      for (var i = 1; i < parts.length; ++i) {
        var properties = trellis.get_all_properties()
        var property = properties[parts[i]]
        if (!property)
          throw new Error('Could not find ' + trellis.name + '.' + parts[i] + '.')

        sql += Query.generate_join(property, cross_property)
        cross_property = property.get_relationship() == Relationships.many_to_many ? property : null
        trellis = property.other_trellis
      }

      if (args[1]) {
//        sql += ' AND ' + trellis.query_primary_key() + ' = '
        sql += ' AND ' + Query.get_identity_sql(property, cross_property) + ' = '
          + trellis.properties[trellis.primary_key].get_sql_value(args[1]) + '\n'
      }

      sql += 'WHERE ' + first_trellis.query_primary_key() + ' = '
        + first_trellis.properties[first_trellis.primary_key].get_sql_value(args[0]) + '\n'

      return sql
    }

    private static
      process_tokens(tokens:string[], args, ground) {
      var result = []
      var trellis
      for (var i = 0; i < tokens.length; ++i) {
        var token = tokens[i]
        if (token[0] == ':') {
          var arg = args[token]
          trellis = arg.trellis
        }
      }

      return result
    }
  }
}