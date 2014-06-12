/// <reference path="../references.ts"/>

module Ground {

  export module SQL {
    export function get_link_sql_value(link:Link_Field, value) {
      if (this.property)
        return this.property.get_sql_value(value)

      return this.other_property.property.get_other_property(true).get_sql_value(value)
    }
  }
}