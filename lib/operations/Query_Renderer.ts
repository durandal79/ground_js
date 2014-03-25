/// <reference path="../references.ts"/>

module Ground {

  export class Query_Renderer {
    ground:Core
//    fields:string[] = []
//    joins:string[] = []
//    arguments = {}
//    filters:string[] = []
//    post_clauses:any[] = []

    static counter = 1

    constructor(ground:Core) {
      this.ground = ground
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

    generate_sql(source:Query_Builder) {
      var properties = Query_Renderer.get_properties(source)
      var data = Query_Renderer.get_fields_and_joins(source, properties)
      var data2 = Query_Renderer.process_property_filters(source, this.ground)
      var fields = data.fields
      var joins = data.joins.concat(data2.joins)
      var args = data2.arguments
      var filters = data2.filters || []

      if (fields.length == 0)
        throw new Error('No authorized fields found for trellis ' + source.trellis.name + '.');

      var sql = 'SELECT '
      sql += fields.join(",\n")
      sql += "\nFROM `" + source.trellis.get_table_name() + '`'
      if (joins.length > 0)
        sql += "\n" + joins.join("\n")

      if (filters.length > 0)
        sql += "\nWHERE " + filters.join(" AND ")

      if (source.sorts.length > 0)
        sql += ' ' + Query_Renderer.process_sorts(source.sorts, source.trellis)

//      if (this.post_clauses.length > 0)
//        sql += " " + this.post_clauses.join(" ")

      for (var i = 0; i < source.transforms.length; ++i) {
        var transform = source.transforms[i]
        var temp_table = 'transform_' + (i + 1)
        sql = 'SELECT * FROM (' + sql + ' ) ' + temp_table + ' ' + transform.clause
      }

      for (var pattern in args) {
        var value = args[pattern];
//        console.log('arg', pattern, value)
//        sql = sql.replace(new RegExp(pattern), Property.get_sql_value(value));
        sql = sql.replace(new RegExp(pattern, 'g'), value);
      }

      if (source.pager) {
        sql += ' ' + Query_Renderer.render_pager(source.pager)
      }

      return sql;
    }

    private static get_fields_and_joins(source:Query_Builder, properties, include_primary_key:boolean = true):Internal_Query_Source {
      var name, fields:string[] = [];
      var trellises = {};
      for (name in properties) {
        var property = properties[name];
        // Virtual properties aren't saved to the database
        // Useful when you define custom serialization hooks
        if (property.type == 'list' || property.is_virtual)
          continue;

        if (property.name != source.trellis.primary_key || include_primary_key) {
          var sql = property.get_field_query()
          fields.push(sql);
          if (property.parent.name != source.trellis.name)
            trellises[property.parent.name] = property.parent
        }
      }
      var joins = [];
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

    private static process_property_filter(source:Query_Builder, filter, ground:Core):Internal_Query_Source {
      var result = {
        filters: [],
        arguments: {},
        joins: []
      }
      var property = source.trellis.sanitize_property(filter.property);
      var value = filter.value;

      var placeholder = ':' + property.name + '_filter' + Query_Renderer.counter++;
      if (Query_Renderer.counter > 10000)
        Query_Renderer.counter = 1

      if (value === 'null' && property.type != 'string') {
        result.filters.push(property.query() + ' IS NULL');
        return result;
      }

      if (value !== null)
        value = ground.convert_value(value, property.type);

      if (value === null || value === undefined) {
        throw new Error('Query property filter ' + placeholder + ' is null.')
      }

      if (property.get_relationship() == Relationships.many_to_many) {
//        throw new Error('Filtering many to many will need to be rewritten for the new Link_Trellis.');
        var join_seed = {}, s = {}
        s[property.other_trellis.primary_key] = placeholder
        join_seed[property.other_trellis.name] = s

        result.joins.push(Query_Renderer.generate_property_join(property, join_seed));
      }
      else {
        var operator_action = Query_Builder.operators[filter.operator]
        if (operator_action && typeof operator_action.render === 'function') {
          var data = {
            value: value,
            placeholder: placeholder
          }
          operator_action.render(result, filter, property, data)
          value = data.value
          placeholder = data.placeholder
        }
        else {
          result.filters.push(property.query() + ' ' + filter.operator + ' ' + placeholder);
        }
      }

      if (value !== null) {
        value = property.get_sql_value(value)
        result.arguments[placeholder] = value;
      }

      return result;
    }

    static process_property_filters(source:Query_Builder, ground:Core):Internal_Query_Source {
      var result = {}
      for (var i in source.filters) {
        var filter = source.filters[i]
        MetaHub.extend(result, Query_Renderer.process_property_filter(source, filter, ground))
      }
      return result
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