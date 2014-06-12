/// <reference path="../references.ts"/>

module Ground {

  export interface IQuery_Preparation {
    queries?:string[]
    is_empty:boolean
  }

  export interface IQuery_Render_Result {
    sql:string
    parts
  }

  export class Query_Runner {
    source:Query_Builder
    run_stack
    private row_cache
    ground:Core
    renderer:Query_Renderer

    constructor(source:Query_Builder) {
      this.source = source
      this.ground = source.ground
      this.renderer = new Query_Renderer(this.ground)
    }

    private static generate_property_join(property:Property, seeds) {
      var join = Link_Trellis.create_from_property(property);
      return join.generate_join(seeds);
    }

    private static create_sub_query(trellis:Trellis, property:Property, source:Query_Builder):Query_Builder {
      var query = new Query_Builder(trellis)
      var original_query = source.subqueries[property.name]
      if (original_query) {
        MetaHub.extend(query.subqueries, original_query.subqueries)
        if (original_query.source)
          query.extend(original_query.source)
      }
      else if (typeof source.properties === 'object'
        && typeof source.properties[property.name] === 'object') {
        query.extend(source.properties[property.name])
      }
      query.include_links = false;

      return query
    }

    private static get_many_list(seed, property:Property, relationship:Relationships, source:Query_Builder):Promise {
      var id = seed[property.parent.primary_key]
      if (id === undefined || id === null)
        throw new Error('Cannot get many-to-many list when seed id is null.')

      var other_property = property.get_other_property();
      if (!other_property)
        throw new Error("Could not find other property for " + property.fullname() + ".")
//        return when.resolve()

      var query = Query_Runner.create_sub_query(other_property.parent, property, source);
//      if (relationship === Relationships.many_to_many) {
////        query.filters.push(Query_Builder.create_join_filter(property, seed))
//        query.add_filter(property.name, seed)
//      }
//      else if (relationship === Relationships.one_to_many)
//        query.add_filter(other_property.name, id)

      query.add_filter(other_property.name, id)
      return query.run();
    }

    private static get_path(...args:string[]):string {
      var items:string[] = [];
//      if (this.base_path)
//        items.push(this.base_path);

      items = items.concat(args);
      return items.join('/');
    }

    private static get_reference_object(row, property:Property, source:Query_Builder) {
      var query = Query_Runner.create_sub_query(property.other_trellis, property, source)
      var value = row[property.name]
      if (!value)
        return when.resolve(value)

      query.add_key_filter(value);
      return query.run()
        .then((result) => result.objects[0])
    }

    process_map(row, source:Query_Builder, links) {
      var replacement = undefined
      var all_properties = source.trellis.get_all_properties()
      var context = {
//          properties: source.trellis.get_all_properties()
        properties: row
      }
      for (var i in source.map) {
        var expression = source.map[i]
        var value = Expression_Engine.resolve(expression, context)
        if (i == 'this') {
          replacement = value
          break
        }
        if (value !== undefined)
          row[i] = value
      }
      MetaHub.map_to_array(links, (property, name) => {
        if (property.is_composite_sub)
          return null

        var path = Query_Runner.get_path(property.name)
        var subquery = source.subqueries[property.name]

        if (source.include_links || subquery) {
          return this.query_link_property(row, property, source).then((value) => {
            row[name] = value
            return row
          })
        }

        return null
      })

      return replacement
    }

    process_row_step_one(row, source:Query_Builder):Promise {
      var type_property = source.trellis.type_property

      var trellis = type_property && row[type_property.name]
        ? this.ground.sanitize_trellis_argument(row[type_property.name])
        : source.trellis

      if (trellis != source.trellis) {
        var query = new Query_Builder(trellis)
        query.add_key_filter(trellis.get_identity2(row))
        if (source.properties)
          query.properties = source.properties
        if (source.map)
          query.map = source.map

        return query.run_single()
          .then((row)=> this.process_row_step_two(row, source, trellis))
      }
      else {
        return this.process_row_step_two(row, source, trellis)
      }
    }

    process_row_step_two(row, source:Query_Builder, trellis:Trellis):Promise {
      var name, property, replacement = undefined

      var properties = trellis.get_core_properties()
      for (name in properties) {
        property = properties[name]
        var value = row[property.name]
        if (value === undefined)
          continue

        row[property.name] = this.ground.convert_value(value, property.type)
      }

      var links = trellis.get_all_links((p)=> !p.is_virtual);

      var tree = trellis.get_tree().filter((t:Trellis)=> !t.is_virtual);
      var promises = MetaHub.map_to_array(links, (property, name) => {
        if (property.is_composite_sub)
          return null

        var path = Query_Runner.get_path(property.name)
        var subquery = source.subqueries[property.name]

        if (source.include_links || subquery) {
          return this.query_link_property(row, property, source).then((value) => {
            row[name] = value
            return row
          })
        }

        return null
      })
        .concat(tree.map((trellis) => ()=> this.ground.invoke(trellis.name + '.queried', row, this)))

      if (typeof source.map === 'object') {
        replacement = this.process_map(row, source, links)
      }

      return when.all(promises)
//        .then(()=> this.ground.invoke(trellis.name + '.queried', row, this))
        .then(()=> replacement === undefined ? row : replacement)
    }

    query_link_property(seed, property, source:Query_Builder):Promise {
      var relationship = property.get_relationship()

      switch (relationship) {
        case Relationships.one_to_one:
          return Query_Runner.get_reference_object(seed, property, source)
          break
        case Relationships.one_to_many:
        case Relationships.many_to_many:
          return Query_Runner.get_many_list(seed, property, relationship, source)
            .then((result)=> result ? result.objects : [])
          break
      }

      throw new Error('Could not find relationship: ' + relationship + '.')
    }

    prepare():Promise {
      var source = this.source
      if (this.row_cache)
        return when.resolve(this.row_cache)

      var tree = source.trellis.get_tree()
      var promises = tree.map((trellis:Trellis) => ()=> this.ground.invoke(trellis.name + '.query', source))
      promises = promises.concat(()=> this.ground.invoke('*.query', source))

      var is_empty = false

      if (source.filters) {
        for (var i in source.filters) {
          var filter = source.filters[i]
          var operator_action = Query_Builder.operators[filter.operator]
          if (operator_action && typeof operator_action.prepare === 'function') {
            if (filter.property) {
              var property = source.trellis.sanitize_property(filter.property);
              promises.push(()=> operator_action.prepare(filter, property)
                  .then((result) => {
                    if (result === false)
                      is_empty = true
                  })
              )
            }
          }
        }
      }

      var queries:string[] = []

      if (source.type == 'union') {
        var query_index = 0
        promises = promises.concat(source.queries.map((query)=> ()=> {
          var runner = new Query_Runner(query)
          return runner.render(query_index++)
            .then((result)=> {
              queries.push(result.sql)
              return when.resolve()
            })
        }))
      }

      var sequence = require('when/sequence')
      return sequence(promises)
        .then(()=> {
          return {
            queries: queries,
            is_empty: is_empty
          }
        })
    }

    render(query_id:number = undefined):Promise {
      return this.prepare()
        .then((preparation)=> {
          if (preparation.is_empty)
            return when.resolve(null)

          var source = this.source
          var parts = this.renderer.generate_parts(source, query_id)
          var sql = source.type == 'union'
            ? this.renderer.generate_union(parts, preparation.queries, source)
            : this.renderer.generate_sql(parts, source)

          sql = sql.replace(/\r/g, "\n")
          if (this.ground.log_queries)
            console.log('\nquery', sql + '\n')

          return {
            sql: sql,
            parts: parts,
            preparation: preparation
          }
        })
    }

    run_core():Promise {
      return this.render()
        .then((render_result)=> {
          if (!render_result.sql)
            return when.resolve([])

          return this.ground.db.query(render_result.sql)
            .then((rows)=> {
              var result = {
                objects: rows
              }
              this.row_cache = result
              if (this.source.pager) {
                var sql = this.source.type != 'union'
                  ? this.renderer.generate_count(render_result.parts)
                  : this.renderer.generate_union_count(render_result.parts,
                  render_result.preparation.queries, this.source)

                if (this.ground.log_queries)
                  console.log('\nquery', sql + '\n')
                return this.ground.db.query_single(sql)
                  .then((count)=> {
                    result['total'] = count.total_number
                    return result
                  })
              }
              else {
                return when.resolve(result)
              }
            })
        })
    }

    get_source(row):Query_Builder {
      if (this.source.type !== 'union')
        return this.source

      return this.source.queries[row._query_id_]
    }

    run():Promise {
      if (this.ground.log_queries) {
        var temp = new Error()
        this.run_stack = temp['stack']
      }

      return this.run_core()
        .then((result) => when.all(result.objects.map((row) => this.process_row_step_one(row, this.get_source(row))))
          .then((rows)=> {
            result.objects = rows
            return result
          })
      )
    }

    run_single():Promise {
      return this.run()
        .then((result)=> result.objects[0])
    }
  }
}