/**
 * User: Chris Johnson
 * Date: 9/23/13
 */
/// <reference path="../references.ts"/>

module Ground {
 export class Update {
    private seed:ISeed;
    private fields:any[];
    override:boolean = true;
    trellis:Trellis;
    main_table:string = 'node';
    ground:Core;
    db:Database;
    is_service:boolean = false;
    static log_queries:boolean = false;

    constructor(trellis:Trellis, seed:ISeed, ground:Core = null) {
      this.seed = seed;
      this.trellis = trellis;
      this.main_table = this.trellis.get_table_name();
      this.ground = ground || this.trellis.ground;
      this.db = ground.db;
    }

    private  generate_sql(trellis:Trellis):Promise {
      var duplicate = '', primary_keys;
      var id = this.seed[trellis.primary_key];
      if (!id && id !== 0) {
        return this.create_record(trellis);
      }
      else {
        var table = this.ground.tables[trellis.name];
        if (table && table.primary_keys && table.primary_keys.length > 0)
          primary_keys = table.primary_keys;
        else
          primary_keys = [trellis.primary_key];

        var conditions = [];
        var ids = [];
        for (var key in primary_keys) {
          ids[key] = this.seed[key];
          conditions.push(key + ' = ' + trellis.properties[key].get_field_value(ids[key]));
        }
        var condition_string = conditions.join(' AND ');
        if (!condition_string)
          throw new Error('Conditions string cannot be empty.');

        var sql = 'SELECT ' + primary_keys.join(', ') + ' FROM ' + trellis.get_table_name()
          + ' WHERE ' + condition_string;

        return this.db.query(sql)
          .then((id_result) => {
            if (!id_result)
              return this.create_record(trellis);
            else
              return this.update_record(trellis, id, condition_string);
          });
      }
    }

    private create_record(trellis:Trellis):Promise {
      var fields:string[] = [];
      var values = [];
      var core_properties = trellis.get_core_properties();
      var promises = [];
      for (var name in core_properties) {
        var property = core_properties[name];
        if (this.seed[property.name] !== undefined || this.is_create_property(property)) {
//          console.log('field', name, this.seed[property.name])
          fields.push('`' + property.get_field_name() + '`');
          var field_promise = this.get_field_value(property).then((value) => {
            if (value.length == 0) {
              throw new Error('Field value was empty for inserting ' + property.name + ' in ' + trellis.name + '.');
            }

//            console.log('  ', name, value)
            values.push(value);
          });

          promises.push(field_promise);
        }
      }

      return when.all(promises)
        .then(()=> {
          var field_string = fields.join(', ');
          var value_string = values.join(', ');
          var sql = 'INSERT INTO ' + trellis.get_table_name() + ' (' + field_string + ') VALUES (' + value_string + ");\n";
          if (Update.log_queries)
            console.log(sql);

          return this.db.query(sql)
            .then((result) => {
//              console.log(arguments)
              var id;
              if (this.seed[trellis.primary_key]) {
                id = this.seed[trellis.primary_key];
              }
              else {
                id = result.insertId;
                this.seed[trellis.primary_key] = id;
              }

              return this.update_links(trellis, id, true)
                .then(()=> {
                  return this.ground.invoke(trellis.name + '.create', this.seed, trellis);
                });
            });
        });
    }

    private update_record(trellis:Trellis, id, key_condition):Promise {
      var updates = [];
      var promises = [];
      var core_properties = MetaHub.filter(trellis.get_core_properties(), this.is_update_property);
      for (var name in core_properties) {
        var property = core_properties[name];
        if (this.seed[property.name] !== undefined) {
          var field_string = '`' + property.get_field_name() + '`';
          promises.push(this.get_field_value(property).then((value) => {
            updates.push(field_string + ' = ' + value);
          }));
        }
      }

      return when.all(promises)
        .then(() => {
          var next = ():Promise => {
            return this.update_links(trellis, id)
              .then(()=>this.ground.invoke(trellis.name + '.updated', this.seed, trellis));
          }

          // Check if there's nothing to add
          if (updates.length === 0)
            return next();

          var sql = 'UPDATE ' + trellis.get_table_name() + "\n" +
            'SET ' + updates.join(', ') + "\n" +
            'WHERE ' + key_condition + "\n;";

          if (Update.log_queries)
            console.log(sql);

          return this.db.query(sql).then(next);
        });
    }

    private apply_insert(property:Property, value):string {
      if (property.insert == 'trellis')
        return this.trellis.name;

      if (property.type == 'created' || property.type == 'modified')
        return Math.round(new Date().getTime() / 1000).toString()

      if (!value && property.insert == 'author') {
        throw new Error('Inserting author not yet supported');
      }

      return value.toString();
    }

    is_create_property(property:Property):boolean {
      if (property.is_virtual)
        return false;

      // Ignore shared fields
      var field = property.get_field_override();
      if (field && field.share)
        return false;

      return property.insert == 'trellis' || property.type == 'created'
        || property.type == 'modified' || property.insert == 'author';
    }

    private get_field_value(property:Property):Promise {
      var value = this.seed[property.name];
      value = this.apply_insert(property, value);
      this.seed[property.name] = value;

      return property.get_field_value(value, this.is_service);
    }

    private is_update_property(property:Property):boolean {
      if (property.is_virtual)
        return false;

      // Ignore shared fields
      var field = property.get_field_override();
      if (field && field.share)
        return false;

      if (property.name == property.parent.primary_key || property.type == 'created' || property.insert == 'alter')
        return false;

      return this.seed[property.name] !== undefined || property.insert == 'trellis' || property.type == 'modified';
    }

    private update_links(trellis:Trellis, id, create:boolean = false):Promise {
      var links = trellis.get_links();
      var promises = [];
      for (var name in links) {
        var property = links[name];
        if (this.is_service && !create) {
          if (property.is_readonly || property.is_private)
            continue;
        }

        // The updates are not wrapped in functions and fired sequentially
        // because they don't need to be fired in any particular order;
        switch (property.get_relationship()) {
          case Relationships.one_to_many:
            promises.push(this.update_one_to_many(property, id));
            break;
          case Relationships.many_to_many:
            promises.push(this.update_many_to_many(property, id, create));
            break;
        }
      }

      return when.all(promises);
    }

    private update_many_to_many(property:Property, id, create:boolean = false):Promise {
      var list = this.seed[property.name];
      if (!MetaHub.is_array(list))
        return when.resolve();

//      var join = new Link_Trellis(property);
      throw new Error('Not yet implemented');
    }

    private update_one_to_many(property:Property, id):Promise {
      var seed = this.seed;
      var list = seed[property.name];
      if (!MetaHub.is_array(list))
        return when.resolve();

      var promises = MetaHub.map_to_array(list, (item)=> {
        return this.update_reference_object(item, property, id);
      });

      return when.all(promises);
    }

    private update_reference(property:Property, id):Promise {
      var item = this.seed[property.name];
      if (!item)
        return when.resolve();

      return this.update_reference_object(item, property, id);
    }

    private update_reference_object(object, property:Property, id):Promise {
      var trellis;
      if (object.trellis)
        trellis = object.trellis;
      else
        trellis = property.other_trellis;

      var other_property = property.get_other_property();
      if (other_property && object[other_property.name] !== undefined)
        object[other_property.name] = id;

      return this.ground.update_object(trellis, object);
    }

    public  run():Promise {
      var tree = this.trellis.get_tree().filter((t:Trellis)=> !t.is_virtual);

      var promises = tree.map((trellis:Trellis) => this.generate_sql(trellis));

      return when.all(promises)
        .then(()=> this.seed);
    }
  }
}