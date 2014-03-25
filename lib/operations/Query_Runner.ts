/// <reference path="../references.ts"/>

module Ground {

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
        return when.resolve()

      var query = Query_Runner.create_sub_query(other_property.parent, property, source);
      if (relationship === Relationships.many_to_many) {
//        var seeds = {}
//        seeds[source.trellis.name] = seed
        query.filters.push(Query_Builder.create_join_filter(property, seed))
//        query.add_join(Query_Runner.generate_property_join(property, seeds))
      }
      else if (relationship === Relationships.one_to_many)
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
        .then((rows) => rows[0])
    }

    process_row(row, source:Query_Builder):Promise {
      var name, property

      var properties = source.trellis.get_core_properties()
      for (name in properties) {
        property = properties[name]
        var value = row[property.name]
        if (value === undefined)
          continue

        row[property.name] = this.ground.convert_value(value, property.type)
      }

      var links = source.trellis.get_all_links((p)=> !p.is_virtual);

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

      return when.all(promises)
        .then(()=> this.ground.invoke(source.trellis.name + '.queried', row, this))
        .then(()=> row)
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
          break
      }

      throw new Error('Could not find relationship: ' + relationship + '.')
    }

    run_core():Promise {
      var source = this.source
      if (this.row_cache)
        return when.resolve(this.row_cache)

      var tree = source.trellis.get_tree()
      var promises = tree.map((trellis:Trellis) => ()=> this.ground.invoke(trellis.name + '.query', source))
      promises = promises.concat(()=> this.ground.invoke('*.query', source))
      if (source.filters) {
        for (var i in source.filters) {
          var filter = source.filters[i]
          var operator_action = Query_Builder.operators[filter.operator]
          if (operator_action && typeof operator_action.prepare === 'function') {
            var property = source.trellis.sanitize_property(filter.property);
            promises.push(()=> operator_action.prepare(filter, property))
          }
        }
      }

      var sequence = require('when/sequence')
      return sequence(promises)
        .then(()=> {
          var sql = this.renderer.generate_sql(source)
          sql = sql.replace(/\r/g, "\n")
          if (this.ground.log_queries)
            console.log('\nquery', sql + '\n')

//          var args = MetaHub.values(this.arguments).concat(args);
          return this.ground.db.query(sql)
            .then((rows)=> {
              this.row_cache = rows
              return rows
            })
        })
    }

    run():Promise {
      var source = this.source
      if (this.ground.log_queries) {
        var temp = new Error()
        this.run_stack = temp['stack']
      }

      return this.run_core()
        .then((rows) => when.all(rows.map((row) => this.process_row(row, source))))
    }

    run_single():Promise {
      return this.run()
        .then((rows)=> rows[0])
    }
  }
}