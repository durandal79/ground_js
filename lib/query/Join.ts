/// <reference path="../references.ts"/>

module Ground {

  export interface IJoin {
    render():string
  }

//  export interface ITable_Reference {
//    get_table_name():string
//    query_reference():string
//    query_identity():string
//  }

  export interface Join_Trellis {
    get_table_name():string
    get_primary_keys():Join_Property[]
    get_alias():string
    query_identity():string
  }

  export class Join_Trellis_Wrapper implements Join_Trellis {
    trellis:Trellis
    alias:string

    constructor(trellis:Trellis, alias:string = null) {
      this.trellis = trellis
      var trellis_table_name = trellis ? trellis.get_table_name() : null
      this.alias = alias || trellis_table_name
    }

    static create_using_property(trellis:Trellis, property:Property):Join_Trellis_Wrapper {
      var alias = Join.generate_table_name(trellis, property)
      return new Join_Trellis_Wrapper(trellis, alias)
    }

    get_alias():string {
      return this.alias
    }

    get_primary_keys():Join_Property[] {
      return [ Join_Property.create_from_property(this.trellis.get_primary_property()) ]
    }

    get_table_name():string {
      return this.trellis.get_table_name()
    }

    query_identity():string {
      return this.get_alias() + '.' + this.trellis.get_primary_property().get_field_name()
    }
  }

  export class Cross_Trellis implements Join_Trellis {
    name:string
    alias:string
    properties:Join_Property[]
    identities:Join_Property[]

    constructor(property:Property) {
      var field = property.get_field_override()
      this.name = field
        ? field.other_table
        : Cross_Trellis.generate_name(property.parent, property.other_trellis)

      // Add the property name in case there are cross joins in both directions
      this.alias = 'cross_' + this.name + '_' + property.name
      this.properties = Cross_Trellis.create_properties(this, property)
      this.identities = [ this.properties[1], this.properties[2] ]
    }

    static generate_name(first:Trellis, second:Trellis):string {
      var names = [first.get_table_name(), second.get_table_name()]
      var temp = names.sort()
      return temp.join('_')
    }

    private static get_field_name(property:Property):string {
      var field = property.get_field_override()
      if (field && field.other_field)
        return field.other_field

      return property.parent.name
    }

    get_primary_keys():Join_Property[] {
      return this.identities
    }

    private static create_properties(cross:Cross_Trellis, property:Property):Join_Property[] {
      var other_property:Property = property.get_other_property(true)

      var result = [
        Join_Property.create_from_property(property, cross),
        new Join_Property(cross, new Join_Trellis_Wrapper(property.parent),
          Cross_Trellis.get_field_name(property), "reference"),
        new Join_Property(cross, new Join_Trellis_Wrapper(property.other_trellis),
          Cross_Trellis.get_field_name(other_property), "reference"),
        Join_Property.create_from_property(other_property, cross)
      ]

      Join_Property.pair(result[0], result[1])
      Join_Property.pair(result[2], result[3])
      return result
    }

    generate_delete(property:Property, owner, other):string {
      var identities = this.order_identities(property)
      var conditions = [
        identities[0].get_comparison(owner),
        identities[1].get_comparison(other)
      ]
      return 'DELETE FROM ' + this.get_table_name() + ' WHERE ' + conditions.join(' AND ') + "\n"
    }

    generate_insert(property:Property, owner, other):string {
      var identities = this.order_identities(property)
      var keys = identities.map((x)=> x.field_name)
      var values = [
        identities[0].get_sql_value(owner),
        identities[1].get_sql_value(other)
      ]

      return 'REPLACE INTO ' + this.get_table_name() + ' (`'
        + keys.join('`, `')
        + '`) VALUES ('
        + values.join(', ')
        + ');\n'
    }

    order_identities(property:Property):Join_Property[] {
      var first = this.identities.filter((x)=>x.other_property.name == property.name)[0]
      if (!first) {
        throw new Error('Could not insert into cross table ' + this.get_table_name()
          + '.  Could not find identity for property ' + property.fullname() + '.')
      }
      var second = this.identities[1 - this.identities.indexOf(first)]
      return [ first, second ]
    }

    get_alias():string {
      return this.alias
    }

    get_table_name():string {
      return this.name
    }

    query_identity():string {
      throw new Error('Cross_Trellis.query_identity() should never be called.' +
        '  Cross_Reference only has references, not identities')
    }
  }

  export class Cross_Trellis2 {
    alias:string
    table:Table

    constructor(property:Property, alias:string = null) {
      this.table = Table.get_other_table(property)
      this.alias = alias
    }

//    generate_delete(property:Property, owner, other):string {
//      var identities = this.order_identities(property)
//      var conditions = [
//        identities[0].get_comparison(owner),
//        identities[1].get_comparison(other)
//      ]
//      return 'DELETE FROM ' + this.get_table_name() + ' WHERE ' + conditions.join(' AND ') + "\n"
//    }

    generate_insert(property:Property, owner, other):string {
      var identities = this.order_identities(property)
      var keys = identities.map((x)=> x.name)
      var values = [
        SQL.get_link_sql_value(identities[0], owner),
        SQL.get_link_sql_value(identities[1], other)
      ]

      return 'REPLACE INTO ' + this.table.name + ' (`'
        + keys.join('`, `')
        + '`) VALUES ('
        + values.join(', ')
        + ');\n'
    }

    order_identities(property:Property):Link_Field[] {
      var table = this.table
      var first = MetaHub.filter(table.links, (x)=>x.name == property.name)[0]
      if (!first) {
        throw new Error('Could not operate using cross table ' + this.table.name
          + '.  Could not find identity for property ' + property.fullname() + '.')
      }
      MetaHub.filter(table.links, (x)=>x.name == property.name)[0]
      var second = MetaHub.filter(table.links, (x)=>x.name == property.name)[0]
      return [ first, second ]
    }

//    query_identity():string {
//      throw new Error('Cross_Trellis.query_identity() should never be called.' +
//        '  Cross_Reference only has references, not identities')
//    }
  }

  export class Join_Property {
    parent:Join_Trellis
    other_trellis:Join_Trellis
    field_name:string
    type:string
    other_property:Join_Property
    name:string
    property:Property

    constructor(parent:Join_Trellis, other_trellis:Join_Trellis, name:string, type:string, field_name:string = null, other_property:Join_Property = null) {
      this.parent = parent
      this.name = name
      this.other_trellis = other_trellis
      this.field_name = field_name || name
      this.type = type
      this.other_property = other_property
    }

    static create_from_property(property:Property, other_trellis:Join_Trellis = null, other_property:Join_Property = null):Join_Property {
      var result = new Join_Property(
        new Join_Trellis_Wrapper(property.parent),
        other_trellis || new Join_Trellis_Wrapper(property.other_trellis),
        property.name,
        property.type,
        property.get_field_name(),
        other_property
      )

      result.property = property
      return result
    }

    get_comparison(value):string {
      return this.query() + ' = ' + this.get_sql_value(value)
    }

    query():string {
      var table_name = this.parent.get_alias() || this.parent.get_table_name()
      return table_name + '.' + this.field_name
    }

    static pair(first:Join_Property, second:Join_Property) {
      first.other_property = second
      second.other_property = first
    }

    get_sql_value(value) {
      if (this.property)
        return this.property.get_sql_value(value)

      return this.other_property.property.get_other_property(true).get_sql_value(value)
    }
  }

  export class Join_Tree {
    property:Property
    trellis:Trellis
    children:Join_Tree[] = []

    constructor(property:Property, trellis:Trellis) {
      this.property = property
      this.trellis = trellis
    }

    static get(tree:Join_Tree[], property:Property, next:Trellis):Join_Tree {
      for (var i = 0; i < tree.length; ++i) {
        var branch = tree[i]
        if (branch.property.name == property.name && branch.trellis.name === next.name)
          return branch
      }
      return null
    }
  }

  export class Join {

    static generate_table_name(trellis:Trellis, property:Property):string {
      return 'link_' +  trellis.name + '_' + property.get_field_name() + '_' + property.parent.name
    }

    static get_last_reference(property_chain:Property[]):Property {
      var property = property_chain[property_chain.length - 1]

      // If the last property isn't a reference, the property before it must be a reference
      // or the chain is invalid.
      if (!property.other_property)
        return property_chain[property_chain.length - 2]
    }

    static paths_to_tree(base:Trellis, paths:any[]):Join_Tree[] {
      var result:Join_Tree[] = [], target:Join_Tree[], path:Property[]

      for (var i = 0; i < paths.length; ++i) {
        var trellis = base
        path = paths[i]
        target = result
        for (var x = 0; x < path.length - 1; ++x) {
          var property = path[x]
          var next:Trellis = path[x + 1].parent
          var branch = Join_Tree.get(target, property, next)
          if (!branch) {
            branch = new Join_Tree(property, next)
            target.push(branch)
          }
          target = branch.children
        }
      }

      return result
    }

    private static convert(branch:Join_Tree, previous:Join_Trellis, result:IJoin[]):Join_Trellis {
      var join_property:Join_Property, cross:Cross_Trellis, join_trellis
      if (branch.property.get_relationship() == Relationships.many_to_many) {
        cross = new Cross_Trellis(branch.property)
        result.push(new Reference_Join(cross.properties[0], previous, cross))
        previous = cross
        join_property = cross.properties[2]
      }
      else {
        join_property = Join_Property.create_from_property(branch.property)
        Join_Property.pair(join_property, Join_Property.create_from_property(branch.property.get_other_property(true)))
      }

      var other_property = branch.property.get_other_property(true)

      // joined trellises usually require two trellis properties to be useful, and sometimes those properties
      // are not in the same table, so composite join must be added to bridge the gap.
      if (branch.property.type == 'list' && other_property.parent !== branch.trellis) {
        join_trellis = Join_Trellis_Wrapper.create_using_property(branch.trellis, branch.property)
        var alias = 'composite_' + join_trellis.alias + '_' + branch.property.other_trellis.name
        var join_trellis2 = new Join_Trellis_Wrapper(branch.property.other_trellis, alias)
        result.push(new Reference_Join(join_property, previous, join_trellis2))

        result.push(new Composite_Join(join_trellis2, join_trellis))
        return join_trellis
      }
      else {
        join_trellis = Join_Trellis_Wrapper.create_using_property(branch.trellis, branch.property)
        result.push(new Reference_Join(join_property, previous, join_trellis))
        return join_trellis
      }
    }

    static tree_to_joins(tree:Join_Tree[], previous:Join_Trellis = null):IJoin[] {
      var result:IJoin[] = [], base:Join_Trellis

      for (var i = 0; i < tree.length; ++i) {
        var branch:Join_Tree = tree[i], cross:Cross_Trellis = null
        if (!previous) {
          base = new Join_Trellis_Wrapper(branch.property.parent)
        }
        var join_trellis = Join.convert(branch, previous || base, result)
        result = result.concat(Join.tree_to_joins(branch.children, join_trellis))
      }

      return result
    }

    static render_paths(trellis:Trellis, paths:Property[][]):string[] {
      var tree = Join.paths_to_tree(trellis, paths)
      var joins = Join.tree_to_joins(tree)
      return joins.map((join)=> join.render())
    }

    static path_to_property_chain(base:Trellis, path):Property[] {
      var parts = Ground.path_to_array(path)
      var trellis = base
      var result = []

      for (var i = 0; i < parts.length; ++i) {
        var part = parts[i]
        var property = trellis.get_property(part)

        result.push(property)
        trellis = property.other_trellis
      }

      return result
    }

    static get_end_query(property_chain:Property[]):string {
      var last_property = property_chain[property_chain.length - 1]
      if (property_chain.length == 1 && last_property.get_relationship() != Relationships.many_to_many )
        return last_property.parent.get_table_name() + '.' + last_property.get_field_name()

      var last_reference = Join.get_last_reference(property_chain)
      var table_name = Join.generate_table_name(last_property.parent, last_reference)
      return table_name + '.' + last_property.get_field_name()
    }
  }

  export class Reference_Join implements IJoin {

    property:Join_Property
    first:Join_Trellis
    second:Join_Trellis

    constructor(property:Join_Property, first:Join_Trellis, second:Join_Trellis) {
      this.property = property
      this.first = first
      this.second = second
    }

    render():string {
      return 'LEFT JOIN ' + this.second.get_table_name() + ' ' + this.second.get_alias()
        + ' ON ' + this.get_condition()
    }

    private get_condition() {
      if (this.property.type === 'reference')
        return this.get_query_reference(this.first, this.property) + ' = ' + this.second.query_identity()
      else
        return this.first.query_identity() + ' = ' + this.get_query_reference(this.second, this.property.other_property)
    }

    private get_query_reference(trellis:Join_Trellis, property:Join_Property):string {
      return trellis.get_alias() + '.' + property.field_name
    }
  }

  export class Composite_Join implements IJoin {
    first:Join_Trellis
    second:Join_Trellis

    constructor(first:Join_Trellis, second:Join_Trellis) {
      this.first = first
      this.second = second
    }

    render():string {
      return 'LEFT JOIN ' + this.second.get_table_name() + ' ' + this.second.get_alias()
        + ' ON ' + this.get_condition()
    }

    private get_condition() {
      return this.first.query_identity() + ' = ' + this.second.query_identity()
    }
  }

}