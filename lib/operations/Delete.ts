/**
 * User: Chris Johnson
 * Date: 9/25/13
 */
/// <reference path="../references.ts"/>

module Ground {
  export class Delete implements IUpdate {
    ground:Core
    trellis:Trellis
    seed
    max_depth = 20

    constructor(ground:Core, trellis:Trellis, seed:ISeed) {
      this.ground = ground
      this.trellis = trellis
      this.seed = seed
    }

    get_access_name():string {
      return this.trellis + '.delete'
    }

    private delete_child(link:Property, id, depth = 0):Promise {
      var other_property = link.get_other_property()
      var other_trellis = other_property.parent
      var query = other_trellis.ground.create_query(other_trellis.name)
      query.add_key_filter(id)
      return query.run()
        .then((objects)=> when.all(
          objects.map((object)=> this.run_delete(other_trellis, object, depth + 1))
        )
      )
    }

    private delete_children(trellis:Trellis, id, depth:number = 0):Promise {
      var links = this.get_child_links(trellis)
      return when.all(links.map(
        (link) => this.delete_child(link, id, depth)
      ))
    }

    delete_record(trellis:Trellis, id):Promise {
//      var primary_property = trellis.properties[trellis.primary_key]
      var sql = 'DELETE FROM ' + trellis.get_table_name()
        + "\nWHERE " + trellis.query_primary_key() + ' = ' + id

      if (this.ground.log_updates)
        console.log(sql);

      return this.ground.db.query(sql)
    }

    private get_child_links(trellis:Trellis) {
      var result = [], links = trellis.get_links()
      for (var i in links) {
        var link = links[i]
        var other = link.get_other_property()
        // The other trellis may not have a reciprocal property
        if (other && (other.name == 'parent' || other.is_parent))
          result.push(link)
      }

      return result
    }

    run(depth:number = 0):Promise {
      var trellis = this.trellis
      var seed = this.seed
      return this.run_delete(trellis, seed, depth)
    }

    private run_delete(trellis:Trellis, seed:ISeed, depth:number = 0):Promise {
      if (depth > this.max_depth)
        throw new Error("Max depth of " + this.max_depth + " exceeded.  Possible infinite loop.")
      console.log('deleting')
      var id = seed[trellis.primary_key]
      if (id === null || id === undefined)
        throw new Error("Object was tagged to be deleted but has no identity.")

      id = trellis.properties[trellis.primary_key].get_sql_value(id)
      var property_names = MetaHub.map_to_array(trellis.get_all_properties(), (x)=> x.name)

      return trellis.assure_properties(seed,property_names)
        .then((seed)=> {
          var tree = trellis.get_tree().filter((t:Trellis)=> !t.is_virtual)
          var invoke_promises = tree.map((trellis:Trellis) => this.ground.invoke(trellis.name + '.delete', seed))

          return when.all(invoke_promises)
            .then(()=> when.all(tree.map((trellis:Trellis) => this.delete_record(trellis, id))))
            .then(()=> when.all(tree.map((trellis:Trellis) => this.ground.invoke(trellis.name + '.deleted', seed))))
            .then(()=> this.delete_children(trellis, id, depth))
        })
    }
  }
}