/// <reference path="../references.ts"/>

var uuid = require('node-uuid')

module Ground {
  export interface IUser {
    id
  }

  export class Update implements IUpdate {
    seed:ISeed;
    private fields:any[];
    override:boolean = true;
    trellis:Trellis;
    main_table:string = 'node';
    ground:Core;
    db:Database;
    user:IUser
    log_queries:boolean = false
    run_stack

    constructor(trellis:Trellis, seed:ISeed, ground:Core = null) {
      if (typeof seed !== 'object')
        throw new Error('Seed passed to ' + trellis.name + ' is a ' + (typeof seed) + ' when it should be an object.')

      if (!seed)
        throw new Error('Seed passed to ' + trellis.name + ' is null')

      this.seed = seed;
      this.trellis = trellis;
      this.main_table = this.trellis.get_table_name();
      this.ground = ground || this.trellis.ground;
      this.db = ground.db;
    }

    get_access_name():string {
      return this.trellis + '.update'
    }

    private generate_sql(trellis:Trellis):Promise {
      var duplicate = '', primary_keys;
      var id = this.seed[trellis.primary_key];
      if (!id && id !== 0) {
        return this.create_record(trellis);
      }
      else {
        var table = trellis.get_root_table()
        if (table && table.primary_keys && table.primary_keys.length > 0)
          primary_keys = table.primary_keys;
        else
          primary_keys = [trellis.primary_key];

        var conditions = [];
        var ids = [];
        for (var i in primary_keys) {
          var key = primary_keys[i]
          ids[key] = this.seed[key]
          // Note I'm not referencing key against all of the trellis properties because
          // I'm assuming that the key is a part of the trellis core properties since
          // it is a primary key.
          var value = trellis.properties[key].get_sql_value(ids[key])
          conditions.push(key + ' = ' + value);
        }

        var condition_string = conditions.join(' AND ');
        if (!condition_string)
          throw new Error('Conditions string cannot be empty.');

        var sql = 'SELECT ' + primary_keys.join(', ') + ' FROM `' + trellis.get_table_name()
          + '` WHERE ' + condition_string;

        return this.db.query_single(sql)
          .then((id_result) => {
            if (!id_result)
              return this.create_record(trellis);
            else
              return this.update_record(trellis, id, condition_string);
          });
      }
    }

    private update_embedded_seed(property, value):Promise {
      var type_property = property.parent.type_property

      var type = type_property
        ? value[type_property.name]
        : null

      var other_trellis = value.trellis || type || property.other_trellis
      return this.ground.update_object(other_trellis, value, this.user)
        .then((entity)=> {
//          var other_id = this.get_other_id(value);
//          if (other_id !== null)
//            value = other_id;
//          else
//            value = entity[trellis.primary_key];
//
//          var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key]
//          return other_primary_property.get_field_value(value, as_service, update)

          this.seed[property.name] = entity
        })
    }

    private update_embedded_seeds(core_properties) {
      var promises = [];
      for (var name in core_properties) {
        var property = core_properties[name];
        var value = this.seed[property.name]
        if (property.type == 'reference' && value && typeof value === 'object') {
          promises.push(this.update_embedded_seed(property, value));
        }
      }

      return when.all(promises)
    }

    private create_record(trellis:Trellis):Promise {
      var fields:string[] = [];
      var values = [];
      var core_properties = trellis.get_core_properties();

      if (core_properties[trellis.primary_key].type == 'guid' && !this.seed[trellis.primary_key]) {
        this.seed[trellis.primary_key] = uuid.v1()
      }

      // Update any embedded seeds before the main update
      return this.update_embedded_seeds(core_properties)
        .then(()=> {
          var add_fields = (properties, seed) => {
            for (var name in properties) {
              var property = properties[name];
              var seed_name = property.get_seed_name()
              if (seed[seed_name] === undefined && !this.is_create_property(property))
                continue

              var value = this.get_field_value(property, seed)
              fields.push('`' + property.get_field_name() + '`');
              values.push(value);

              var composite_properties = property.composite_properties
              var composite_seed = seed[seed_name]
              if (composite_properties && composite_properties.length > 0 && typeof composite_seed === 'object') {
                add_fields(composite_properties, composite_seed)
              }
            }
          }

          add_fields(core_properties, this.seed)

          var field_string = fields.join(', ')
          var value_string = values.join(', ')
          var sql = 'INSERT INTO `' + trellis.get_table_name() + '` (' + field_string + ') VALUES (' + value_string + ");\n";
          if (this.log_queries)
            console.log(sql);

          return this.db.query(sql)
            .then((result) => {
              var id;
              if (this.seed[trellis.primary_key]) {
                id = this.seed[trellis.primary_key]
              }
              else {
                id = result.insertId;
                this.seed[trellis.primary_key] = id
              }

              return this.update_links(trellis, id, true)
                .then(()=> {
                  return this.ground.invoke(trellis.name + '.created', this.seed, this)
                })
            })
        })
    }

    private update_record(trellis:Trellis, id, key_condition):Promise {
      var core_properties = MetaHub.filter(trellis.get_core_properties(), (p)=> this.is_update_property(p));

      return this.update_embedded_seeds(core_properties)
        .then(() => {
          var next = ():Promise => {
            return this.update_links(trellis, id)
              .then(()=>this.ground.invoke(trellis.name + '.updated', this.seed, this));
          }

          var updates = [];

          // I don't think we need to be worrying about composite properties
          // here because this should not be updating any identities.
          for (var name in core_properties) {
            var property = core_properties[name];
            if (this.seed[property.name] === undefined) {
              if (property.insert == 'trellis') {
                this.seed[property.name] = this.trellis.name
              }
              else
                continue
            }
            var field_string = '`' + property.get_field_name() + '`';
            var value = this.get_field_value(property, this.seed)
            updates.push(field_string + ' = ' + value);

          }

          // Check if there's nothing to add
          if (updates.length === 0)
            return next();

          var sql = 'UPDATE `' + trellis.get_table_name() + "`\n" +
            'SET ' + updates.join(', ') + "\n" +
            'WHERE ' + key_condition + "\n;";

          if (this.log_queries)
            console.log(sql);

          return this.db.query(sql).then(next);
        });
    }

    private apply_insert(property:Property, value) {
      if (property.insert == 'trellis')
        return this.trellis.name;

      if (property.type == 'created' || property.type == 'modified')
        return Math.round(new Date().getTime() / 1000)

      if (!value && property.insert == 'author') {
        if (!this.user) {
          throw new Error('Cannot insert author into ' + property.parent.name + '.' + property.name + ' because current user is not set.')
        }
        return this.user.id
      }

      return value
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

    private get_field_value(property:Property, seed) {
      var name = property.get_seed_name()
      var value = seed[name];
      value = this.apply_insert(property, value);
      seed[name] = value;

      return property.get_sql_value(value);
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
        if (!create) {
          if (property.is_readonly || property.is_private)
            continue;
        }

        // The updates are not wrapped in functions and fired sequentially
        // because they don't need to be fired in any particular order;
        switch (property.get_relationship()) {
          case Relationships.one_to_many:
            promises.push(this.update_one_to_many(property));
            break;
          case Relationships.many_to_many:
            promises.push(this.update_many_to_many(property, create));
            break;
        }
      }

      return when.all(promises);
    }

    private update_many_to_many(property:Property, create:boolean = false):Promise {
      var list = this.seed[property.name];
      var row = this.seed
      if (!MetaHub.is_array(list))
        return when.resolve();

      var join = Link_Trellis.create_from_property(property);
      var other_trellis = property.get_referenced_trellis()

      var update = (other)=> {
        var sql, other_id = other_trellis.get_id(other)
        // First updated the embedded list object into the database, then link it to the main seed.
        return this.update_reference_object(other, property)
          .then(() => {
            // Clients can use the _remove flag to detach items from lists without deleting them
            if (typeof other === 'object' && other._removed_) {
              if (other_id !== null) {
                var cross = new Cross_Trellis(property)
                cross['alias'] = null

                sql = cross.generate_delete(property, row, other)
                if (this.ground.log_updates)
                  console.log(sql)

                return this.ground.invoke(join.table_name + '.remove', row, property, other, join)
                  .then(() => this.db.query(sql))
                  .then(() => this.ground.invoke(join.table_name + '.removed', row, property, other, join))
              }
            }
            else {
              if (other_id === null) {
                other = this.ground.update_object(other_trellis, other, this.user)
                  .then((other)=> {
                    var cross = new Cross_Trellis(property)
                    sql = cross.generate_insert(property, row, other)
                    if (this.ground.log_updates)
                      console.log(sql)

                    return this.ground.invoke(join.table_name + '.create', row, property, other, join)
                      .then(() => this.db.query(sql))
                      .then(() => this.ground.invoke(join.table_name + '.created', row, property, other, join))
                  })
              }
              else {
                var cross = new Cross_Trellis(property)
                sql = cross.generate_insert(property, row, other)
                if (this.ground.log_updates)
                  console.log(sql)

                return this.ground.invoke(join.table_name + '.create', row, property, other, join)
                  .then(() => this.db.query(sql))
                  .then(() => this.ground.invoke(join.table_name + '.created', row, property, other, join))
              }
            }
          })
      }

      return when.all(list.map(update))
    }

    private update_one_to_many(property:Property):Promise {
      var seed = this.seed
      var list = seed[property.name]
      if (!MetaHub.is_array(list))
        return when.resolve()

      var promises = MetaHub.map_to_array(list, (item) =>
          this.update_reference_object(item, property)
      )

      return when.all(promises)
    }

    private update_reference(property:Property, id):Promise {
      var item = this.seed[property.name]
      if (!item)
        return when.resolve()

      return this.update_reference_object(item, property)
    }

    private update_reference_object(other, property:Property):Promise {
      if (typeof other !== 'object') {
        // Test if the value is a valid key.  An error will be thrown if it isn't
        property.get_sql_value(other)
        return when.resolve()
      }

      var trellis;
      if (other.trellis)
        trellis = other.trellis;
      else
        trellis = property.other_trellis;

      var other_property = property.get_other_property();
      if (other_property) {
        other[other_property.name] = this.seed[this.trellis.primary_key]
        if (other_property.composite_properties) {
          for (var i = 0; i < other_property.composite_properties.length; ++i) {
            var secondary = other_property.composite_properties[i]
            other[secondary.name] = this.seed[secondary.get_other_property(true).name]
          }
        }
      }

      return this.ground.update_object(trellis, other, this.user);
    }

    public run():Promise {
      var pipeline = require('when/pipeline')

      if (this.log_queries) {
        var temp = new Error()
        this.run_stack = temp['stack']
      }

      var tree = this.trellis.get_tree().filter((t:Trellis)=> !t.is_virtual);
      var invoke_promises = tree.map((trellis:Trellis) => ()=> this.ground.invoke(trellis.name + '.update', this.seed, this));

      invoke_promises = invoke_promises.concat(()=> this.ground.invoke('*.update', this.seed, this))

      return pipeline(invoke_promises)
        .then(()=> {
          var promises = tree.map((trellis:Trellis) => ()=> this.generate_sql(trellis));
          return pipeline(promises)
            .then(()=> {
              return this.seed
            })
        })
    }
  }
}