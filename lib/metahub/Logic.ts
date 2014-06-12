/// <reference path="../references.ts"/>

module Ground {

//  export interface Expression {
//    type:string
//  }

  export interface Statement {
    type:string
  }

  export interface Constraint_Statement extends Statement {
    trellis:string
    property:string
    expression:Expression
  }

  export interface Symbol_Statement extends Statement {
    name:string
    expression:Expression
  }

  export interface Function_Expression extends Expression {
    name:string
    arguments:Expression[]
  }

  export interface Reference_Expression extends Expression {
    path:string
  }

  export class Scope {
    symbols = {}

    add_symbol(name:string, value) {
      this.symbols[name] = value
    }
  }

  export class Logic {
    static load(ground:Core, statements:Statement[]) {
      var scope = new Scope()

      for (var i = 0; i < statements.length; ++i) {
        var statement = statements[i]
        switch (statement.type) {
          case 'constraint':
            Logic.load_constraint(ground, <Constraint_Statement>statement, scope)
            break;
          case 'symbol':
            Logic.create_symbol(ground, <Symbol_Statement>statement, scope)
            break;
        }
      }
    }

    static load_constraint(ground:Core, source:Constraint_Statement, scope:Scope):MetaHub.Meta_Object {
      if (source.expression.type == 'function') {
        var func = <Function_Expression>source.expression
        if (func.name == 'count') {
          var reference = <Reference_Expression>func.arguments[0]
          var trellis = ground.sanitize_trellis_argument(source.trellis)
          var property = trellis.get_property(reference.path)
          if (property.get_relationship() !== Relationships.many_to_many)
            return new Record_Count(ground, source.trellis, reference.path, source.property)
          else
            return new Join_Count(ground, property, source.property)
        }
        else if (func.name == 'sum') {
          var sources = func.arguments.map((x)=> <MetaHub.Meta_Object>scope.symbols[(<Reference_Expression>x).path])
          return new Multi_Count(ground, source.trellis, source.property, sources)
        }
      }
    }

    static create_symbol(ground:Core, source:Symbol_Statement, scope:Scope) {
      var value = Logic.load_constraint(ground, <Constraint_Statement>source.expression, scope)
      scope.add_symbol(source.name, value)
    }

//    static call_function(ground:Core, source:Function_Expression, scope:Scope) {
//      switch (source.name) {
//        case 'count':
//          return function_count(ground, source, scope)
//      }
//    }
//
//    static function_count(ground:Core, source:Function_Expression, scope:Scope) {
//      var reference = <Reference_Expression>func.arguments[0]
//      var trellis = ground.sanitize_trellis_argument(source.trellis)
//      var property = trellis.get_property(reference.path)
//      if (property.get_relationship() !== Relationships.many_to_many)
//        return new Record_Count(ground, source.trellis, reference.path, source.property)
//      else
//        return new Join_Count(ground, property, source.property)
//    }
  }
}