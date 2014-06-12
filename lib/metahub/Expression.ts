/// <reference path="../references.ts"/>

module Ground {


  var Expression_Types = [
    'value',
    'function'
  ]

  export interface Expression {
    type?:string
  }

//  export interface Expression_Function extends Expression {
//    name:string
//    args:any[]
//  }

  export class Expression_Engine {
    static resolve(expression, context):any {
      if (typeof expression === 'string') {
        if (typeof expression === 'string' && context.properties[expression] !== undefined) {
          return context.properties[expression]
        }
      }
      else if (expression && typeof expression === 'object') {
        if (expression.type == 'function') {
          return Expression_Engine.resolve_function(<Function_Expression>expression, context)
        }

        if (expression.type == 'literal') {
          return expression.value
        }
      }
    }

    static resolve_function(expression:Function_Expression, context) {
      if (expression.name == 'sum') {

      }
    }
  }
}