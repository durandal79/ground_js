/// <reference path="../references.ts"/>

module Ground {

  export interface Internal_Query_Source {
    fields?
    filters?:any[]
    joins?:string[]
    property_joins?:Property[][]
    arguments?
  }

  export interface Query_Parts {
    fields:string
    from:string
    joins:string
    filters:string
    sorts:string
    pager:string
    args
  }

  export class Query_Renderer {
    ground:Core
    static counter = 1

    constructor(ground:Core) {
      this.ground = ground
    }

    static apply_arguments(sql:string, args):string {
      for (var pattern in args) {
        var value = args[pattern]
        sql = sql.replace(new RegExp(pattern, 'g'), value)
      }

      return sql
    }

    static get_properties(source:Query_Builder) {
      if (source.properties && Object.keys(source.properties).length > 0) {
        var properties = source.trellis.get_all_properties()
        return MetaHub.map(source.properties, (property, key)=> properties[key])
      }
      else {
        return source.trellis.get_all_properties()
      }
    }

    static generate_property_join(property:Property, seeds) {
      var join = Link_Trellis.create_from_property(property);
      console.log('join', property.name, seeds)
      return join.generate_join(seeds);
    }

    generate_sql(parts:Query_Parts, source:Query_Builder) {
      var sql = 'SELECT '
        + parts.fields
        + parts.from
        + parts.joins
        + parts.filters
        + parts.sorts

      for (var i = 0; i < source.transforms.length; ++i) {
        var transform = source.transforms[i]
        var temp_table = 'transform_' + (i + 1)
        sql = 'SELECT * FROM (' + sql + ' ) ' + temp_table + ' ' + transform.clause
      }

      sql = Query_Renderer.apply_arguments(sql, parts.args)
        + parts.pager

      return sql;
    }

    generate_count(parts:Query_Parts) {
      var sql = 'SELECT COUNT(*) AS total_number'
        + parts.from
        + parts.joins
        + parts.filters

      sql = Query_Renderer.apply_arguments(sql, parts.args)

      return sql;
    }

    generate_union(parts:Query_Parts, queries:string[], source:Query_Builder) {
      var alias = source.trellis.get_table_name()
      var sql = 'SELECT DISTINCT * FROM ('
        + queries.join('\nUNION\n')
        + '\n) ' + alias + '\n'
        + parts.filters
        + parts.sorts

      sql = Query_Renderer.apply_arguments(sql, parts.args)
        + parts.pager

      return sql;
    }

    generate_union_count(parts:Query_Parts, queries:string[], source:Query_Builder) {
      var alias = source.trellis.get_table_name()
      var sql = 'SELECT COUNT(DISTINCT ' + source.trellis.query() + ') AS total_number FROM ('
        + queries.join('\nUNION\n')
        + '\n) ' + alias + '\n'
        + parts.filters
        + parts.sorts

      sql = Query_Renderer.apply_arguments(sql, parts.args)

      return sql;
    }

    generate_parts(source:Query_Builder, query_id:number = undefined):Query_Parts {
      var properties = Query_Renderer.get_properties(source)
      var data = Query_Renderer.get_fields_and_joins(source, properties)
      var data2 = Query_Renderer.build_filters(source, this.ground)
      var sorts = source.sorts.length > 0
        ? Query_Renderer.process_sorts(source.sorts, source.trellis, data2)
        : null

      var fields = data.fields
      var joins = data.joins.concat(Join.render_paths(source.trellis, data2.property_joins))
      var args = data2.arguments
      var filters = data2.filters || []
      if (fields.length == 0)
        throw new Error('No authorized fields found for trellis ' + source.trellis.name + '.');

      if (typeof query_id === 'number') {
        fields.push(query_id.toString() + ' AS _query_id_')
      }

      return {
        fields: fields.join(",\n"),
        from: "\nFROM `" + source.trellis.get_table_name() + '`',
        joins: joins.length > 0 ? "\n" + joins.join("\n") : '',
        filters: filters.length > 0 ? "\nWHERE " + filters.join(" AND ") : '',
        sorts: sorts ? ' ' + sorts : '',
        pager: source.pager ? ' ' + Query_Renderer.render_pager(source.pager) : '',
        args: args
      }
    }

    private static get_fields_and_joins(source:Query_Builder, properties, include_primary_key:boolean = true):Internal_Query_Source {
      var name, fields:string[] = [], trellises = {}, joins = []

      var render_field = (name)=> {
        var property = properties[name];
        // Virtual properties aren't saved to the database
        // Useful when you define custom serialization hooks
        if (property.type == 'list' || property.is_virtual)
          return

        if (property.name != source.trellis.primary_key || include_primary_key) {
          var sql = property.get_field_query()
          fields.push(sql);
          if (property.parent.name != source.trellis.name)
            trellises[property.parent.name] = property.parent
        }
      }

      if (source.map && Object.keys(source.map).length > 0) {
        if (!source.map[source.trellis.primary_key])
          render_field(source.trellis.primary_key)

        for (var name in source.map) {
          if (!name.match(/^[\w_]+$/))
            throw new Error('Invalid field name for mapping: ' + name + '.')

          var expression = source.map[name]
          if (!expression.type) {
            render_field(name)
          }
          else if (expression.type == 'literal') {
            var value = expression.value
            if (value === null) {
              value = 'NULL'
            }
            else if (!expression.value.toString().match(/^[\w_]*$/))
              throw new Error('Invalid mapping value: ' + value + '.')

            if (typeof value === 'object') {
              value = "'object'"
            }
            else {
              value = source.ground.convert_value(expression.value, typeof expression.value)
              if (typeof value === 'string')
                value = "'" + value + "'"
            }

            var sql = value + " AS " + name
            fields.push(sql)
          }
          else if (expression.type == 'reference') {
            if (!properties[expression.path])
              throw new Error('Invalid map path: ' + expression.path + '.')

            var sql = expression.path + " AS " + name
            fields.push(sql)
          }
        }
      }
      else {
        for (name in properties) {
          render_field(name)
        }
      }

      for (name in trellises) {
        var trellis = trellises[name];
        var join = source.trellis.get_ancestor_join(trellis);
        if (join)
          joins.push(join);
      }

      return {
        fields: fields,
        joins: joins
      }
    }

    private static add_path(path, trellis:Trellis, result:Internal_Query_Source):any[] {
      var property_chain = Query_Renderer.get_chain(path, trellis)
      return Query_Renderer.add_chain(property_chain, result)
    }

    public static get_chain(path, trellis:Trellis):Property[] {
      if (typeof path === 'string') {
        var parts = Ground.path_to_array(path)
        var property_chain = Join.path_to_property_chain(trellis, parts)
        var last = property_chain[property_chain.length - 1]
        if (last.other_trellis)
          property_chain.push(last.other_trellis.get_primary_property())

        return property_chain
      }
      else {
        return path
      }
    }

    private static add_chain(property_chain, result:Internal_Query_Source):Property[] {
      var property = property_chain[property_chain.length - 1]
      if (property.get_relationship() == Relationships.many_to_many || property_chain.length > 1) {
        result.property_joins = result.property_joins || []
        result.property_joins.push(property_chain)
      }

      return property_chain
    }

    private static build_filter(source:Query_Builder, filter, ground:Core):Internal_Query_Source {
      var result:Internal_Query_Source = {
        filters: [],
        arguments: {},
        property_joins: []
      }
      var value = filter.value,
        operator:string = filter.operator || '=',
        reference:string

      var placeholder = ':' + filter.path.replace(/\./g, '_') + '_filter' + Query_Renderer.counter++;
      if (Query_Renderer.counter > 10000)
        Query_Renderer.counter = 1

      var property_chain = Query_Renderer.add_path(filter.path, source.trellis, result)
      var property = property_chain[property_chain.length - 1]

      if (property.get_relationship() == Relationships.many_to_many || property_chain.length > 1) {
        reference = Join.get_end_query(property_chain)
      }
      else {
        reference = property.query()
      }

      var operator_action = Query_Builder.operators[filter.operator]
      if (operator_action && typeof operator_action.render === 'function') {
        var data = {
          value: value,
          operator: operator,
          placeholder: placeholder,
          reference: reference
        }
        operator_action.render(result, filter, property, data)
        value = data.value
        placeholder = data.placeholder
        operator = data.operator
        reference = data.reference
      }
      else {
        if (value === null || (value === 'null' && property.type != 'string')) {
//        result.filters.push(property.query() + ' IS NULL');
//        return result;
          if (!operator || operator == '=')
            operator = 'IS'
          else if (operator == '!=')
            operator = 'IS NOT'

          value = 'NULL'
        }
        else {
          if (value !== null)
            value = ground.convert_value(value, property.type);
          value = property.get_sql_value(value)
        }
      }

      result.arguments[placeholder] = value;
      result.filters.push(reference + ' ' + operator + ' ' + placeholder)
      return result;
    }

    private static prepare_condition(source:Query_Builder, condition, ground:Core):Internal_Query_Source {
      var result:Internal_Query_Source = {
        filters: [],
        arguments: {},
        property_joins: []
      }
      var value = condition.value,
        operator:string = condition.operator || '='

      var placeholder = ':' + condition.path.join('_') + '_filter' + Query_Renderer.counter++;
      if (Query_Renderer.counter > 10000)
        Query_Renderer.counter = 1

      var property_chain = Query_Renderer.add_path(condition.path, source.trellis, result)
      var property = property_chain[property_chain.length - 1]
      var reference = Join.get_end_query(property_chain)

      var operator_action = Query_Builder.operators[condition.operator]
      if (operator_action && typeof operator_action.render === 'function') {
        var data = {
          value: value,
          operator: operator,
          placeholder: placeholder,
          reference: reference
        }
        operator_action.render(result, condition, property, data)
        value = data.value
        placeholder = data.placeholder
        operator = data.operator
        reference = data.reference
      }
      else {
        if (value === null || (value === 'null' && property.type != 'string')) {
//        result.filters.push(property.query() + ' IS NULL');
//        return result;
          if (!operator || operator == '=')
            operator = 'IS'
          else if (operator == '!=')
            operator = 'IS NOT'

          value = 'NULL'
        }
        else {
          if (value !== null)
            value = ground.convert_value(value, property.type);
          value = property.get_sql_value(value)
        }
      }

      result.arguments[placeholder] = value;
      result.filters.push(reference + ' ' + operator + ' ' + placeholder)
      return result;
    }

    static build_filters(source:Query_Builder, ground:Core):Internal_Query_Source {
      var result = {
        filters: [],
        arguments: {},
        property_joins: []
      }
      for (var i in source.filters) {
        var filter = source.filters[i]
        var additions = Query_Renderer.build_filter(source, filter, ground)

        if (additions.filters.length)
          result.filters = result.filters.concat(additions.filters)

        if (additions.property_joins.length)
          result.property_joins = result.property_joins.concat(additions.property_joins)

        if (Object.keys(additions.arguments).length)
          MetaHub.extend(result.arguments, additions.arguments)
      }
      return result
    }

    static process_sorts(sorts:Query_Sort[], trellis:Trellis, result:Internal_Query_Source):string {
      if (sorts.length == 0)
        return ''

      var properties = trellis.get_all_properties()

      var items = sorts.map((sort)=> {
        var sql
        if (sort.path) {
          var property_chain = Query_Renderer.add_path(sort.path, trellis, result)
          sql = Join.get_end_query(property_chain)
        }
        else {
          if (!properties[sort.property])
            throw new Error(trellis.name + ' does not contain sort property: ' + sort.property)

          sql = properties[sort.property].query()
        }

        if (typeof sort.dir === 'string') {
          var dir = sort.dir.toUpperCase()
          if (dir == 'ASC')
            sql += ' ASC'
          else if (dir == 'DESC')
            sql += ' DESC'
        }

        return sql
      })

      return items.length > 0
        ? 'ORDER BY ' + items.join(', ')
        : ''
    }

    static render_pager(pager:IPager):string {
      var offset = Math.round(pager.offset);
      var limit = Math.round(pager.limit);
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
  }
}