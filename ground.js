/**
* Created with JetBrains PhpStorm.
* User: Chris Johnson
* Date: 9/18/13
*/
var MetaHub;
(function (MetaHub) {
    function remove(array, item) {
        if (typeof array.indexOf != 'function')
            return;

        var index = array.indexOf(item);
        if (index != -1)
            array.splice(index, 1);
    }
    MetaHub.remove = remove;

    function has_properties(obj) {
        for (var key in obj) {
            if (obj.hasOwnProperty(key))
                return true;
        }
        return false;
    }
    MetaHub.has_properties = has_properties;
    ;

    function is_array(obj) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }
    MetaHub.is_array = is_array;

    function size(obj) {
        var size = 0, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key))
                size++;
        }
        return size;
    }
    MetaHub.size = size;
    ;

    function S4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    MetaHub.S4 = S4;

    function values(source) {
        return Object.keys(source).map(function (key) {
            return source[key];
        });
    }
    MetaHub.values = values;

    function concat(destination, source) {
        var result = {};
        for (var a in destination) {
            result[a] = destination[a];
        }

        for (var b in source) {
            result[b] = source[b];
        }

        return result;
    }
    MetaHub.concat = concat;

    function extend(destination, source, names) {
        if (typeof names === "undefined") { names = null; }
        var info;

        if (typeof source == 'object' || typeof source == 'function') {
            if (names == null)
                names = Object.getOwnPropertyNames(source);

            for (var k = 0; k < names.length; ++k) {
                var name = names[k];
                if (source.hasOwnProperty(name)) {
                    if (typeof Object.getOwnPropertyDescriptor == 'function') {
                        info = Object.getOwnPropertyDescriptor(source, name);

                        if (info.get) {
                            Object.defineProperty(destination, name, info);
                            continue;
                        }
                    }

                    if (source[name] === null)
                        destination[name] = null;
else if (MetaHub.is_array(source[name]) && source[name].length == 0)
                        destination[name] = [];
else if (typeof source[name] == 'object' && !MetaHub.has_properties(source[name]))
                        destination[name] = {};
else
                        destination[name] = source[name];
                    //              else
                    //                info.value = source[name];
                    //              Object.defineProperty(destination, name, info);
                    //            }
                }
            }
        }
        return destination;
    }
    MetaHub.extend = extend;

    // Pseudo GUID
    function guid() {
        return S4() + S4() + "-" + S4() + "-" + S4();
    }
    MetaHub.guid = guid;

    function clone(source, names) {
        var result = {};
        MetaHub.extend(result, source, names);
        return result;
    }
    MetaHub.clone = clone;

    function get_connection(a, b) {
        for (var x = 0; x < a.internal_connections.length; x++) {
            if (a.internal_connections[x].other === b) {
                return a.internal_connections[x];
            }
        }

        return null;
    }
    MetaHub.get_connection = get_connection;

    function filter(source, check) {
        var result = {};
        for (var key in source) {
            if (check(source[key], key, source))
                result[key] = source[key];
        }

        return result;
    }
    MetaHub.filter = filter;

    function map(source, action) {
        var result = {};
        for (var key in source) {
            result[key] = action(source[key], key, source);
        }

        return result;
    }
    MetaHub.map = map;

    function map_to_array(source, action) {
        var result = [];
        for (var key in source) {
            result.push(action(source[key], key, source));
        }
        return result;
    }
    MetaHub.map_to_array = map_to_array;

    //  function get_variables(source) {
    //    var result = {};
    //    if (typeof source == 'object' || typeof source == 'function') {
    //      for (var k in source) {
    //        if (source.hasOwnProperty(k) && typeof source[k] != 'function') {
    //          result[k] = source[k];
    //        }
    //      }
    //    }
    //    return result;
    //  }
    //  function serialize(source) {
    //    if (source.original_properties) {
    //      var temp = {};
    //      MetaHub.extend(temp, source, source.original_properties);
    //      return JSON.stringify(temp);
    //      //return JSON.stringify(source, source.original_properties);
    //    }
    //    else {
    //      return JSON.stringify(source);
    //    }
    //  };
    var Meta_Object = (function () {
        function Meta_Object() {
            this.is_meta_object = true;
            this.events = {};
            this.internal_connections = new Array();
        }
        Meta_Object.connect_objects = function (first, other, type) {
            var connection = MetaHub.get_connection(first, other);
            if (connection) {
                if (connection.type != type && type) {
                    connection.type = type;
                    return true;
                }

                return false;
            }

            if (type === 'parent')
                first.parent = other;

            connection = new Meta_Connection(first, other, type);
            first.internal_connections.push(connection);
            return true;
        };

        Meta_Object.disconnect_objects = function (first, other) {
            var connection = MetaHub.get_connection(first, other);
            if (connection) {
                var type = connection.type;
                MetaHub.remove(first.internal_connections, connection);

                for (var event in other.events) {
                    first.unlisten(other, event);
                }

                connection.parent = null;
                connection.other = null;

                first.invoke('disconnect.' + type, other, first);

                if (connection.type === 'parent') {
                    var parents = first.get_connections('parent');
                    if (parents.length == 0) {
                        delete first.parent;
                        if (!first.__disconnecting_everything) {
                            first.disconnect_all();
                        }
                    } else {
                        first.parent = parents[0];
                    }
                }
            }
        };

        Meta_Object.has_property = function (target, name) {
            var x, names = name.split('.');
            for (x = 0; x < names.length; x++) {
                if (!target.hasOwnProperty(names[x]))
                    return false;

                target = target[names[x]];
            }

            return true;
        };

        Meta_Object.invoke_binding = function (source, owner, name) {
            if (!owner.events[name])
                return;

            var args = Array.prototype.slice.call(arguments, 3);
            var info = owner.events[name], length = info.length;
            for (var x = 0; x < length; ++x) {
                var binding = info[x], listener = binding.listener;

                if (listener !== source && listener) {
                    binding.method.apply(listener, args);
                }
            }
        };

        //       toString () {
        //        return this.meta_source + ":" + this.guid;
        //      };
        Meta_Object.prototype.listen = function (other, name, method, options) {
            if (typeof options === "undefined") { options = null; }
            if (typeof method !== 'function')
                throw new Error('Meta_Object.listen requires the passed method to be a function, not a "' + typeof method + '"');

            if (other !== this) {
                if (!other.is_meta_object) {
                    this.connect(other, '');
                }
            }

            if (other.events[name] == null)
                other.events[name] = [];

            var event = {
                method: method,
                listener: this,
                async: false
            };

            if (typeof options == 'object') {
                if (options.once) {
                    event.method = function () {
                        MetaHub.remove(other.events[name], event);
                        method.apply(this, Array.prototype.slice.call(arguments));
                    };
                }
                if (options.async) {
                    event.async = true;
                }
            }

            if (options && options.first)
                other.events[name].unshift(event);
else
                other.events[name].push(event);
        };

        Meta_Object.prototype.unlisten = function (other, name) {
            if (other.events[name] == null)
                return;

            var list = other.events[name];
            for (var i = list.length - 1; i >= 0; --i) {
                if (list[i].listener === this) {
                    list.splice(i, 1);
                }
            }

            if (list.length == 0) {
                delete other.events[name];
            }
        };

        Meta_Object.prototype.invoke = function (name) {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 1); _i++) {
                args[_i] = arguments[_i + 1];
            }
            if (!this.events[name])
                return;

            var info = this.events[name];
            for (var x = 0; x < info.length; ++x) {
                info[x].method.apply(info[x].listener, args);
            }
        };

        Meta_Object.prototype.invoke_async = function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            var finish = args[args.length - 1];
            if (!this.events[name]) {
                if (typeof finish == 'function')
                    finish.apply(this, args.slice(0, args.length - 1));
                return;
            }

            var info = this.events[name];
            var loop = function (x) {
                if (x < info.length) {
                    // Use this eventually:
                    // args[args.length - 1] = loop.bind(this, x + 1);
                    args[args.length - 1] = function () {
                        loop(x + 1);
                    };
                    info[x].method.apply(info[x].listener, args);
                } else {
                    if (typeof finish == 'function')
                        finish.apply(this, args.slice(0, args.length - 1));
                }
            };
            loop(0);
        };

        Meta_Object.prototype.gather = function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            if (!this.events[name])
                return args[0];

            var info = this.events[name];
            for (var x = 0; x < info.length; ++x) {
                args[0] = info[x].method.apply(info[x].listener, args);
            }
            return args[0];
        };

        Meta_Object.prototype.connect = function (other, type, other_type) {
            if (typeof other_type === "undefined") { other_type = undefined; }
            if (other_type == undefined)
                other_type = type;

            if (!other.is_meta_object)
                return;

            if (!Meta_Object.connect_objects(this, other, type)) {
                return;
            }

            Meta_Object.connect_objects(other, this, other_type);

            this.invoke('connect.' + type, other, this);
            other.invoke('connect.' + other_type, this, other);
        };

        Meta_Object.prototype.disconnect = function (other) {
            Meta_Object.disconnect_objects(this, other);
            Meta_Object.disconnect_objects(other, this);
        };

        Meta_Object.prototype.disconnect_all = function (type) {
            if (type == undefined) {
                for (var x = this.internal_connections.length - 1; x >= 0; --x) {
                    this.disconnect(this.internal_connections[x].other);
                }
                this.internal_connections = [];
                this.invoke('disconnect-all', this);
            } else {
                var connections = this.get_connections(type);
                for (var x = connections.length - 1; x >= 0; --x) {
                    this.disconnect(connections[x]);
                }
            }
            //      delete this.__disconnecting_everything;
        };

        Meta_Object.prototype.is_listening = function (other, name) {
            if (!other.is_meta_object)
                return false;

            for (var x in other.events[name]) {
                if (other.events[name][x].listener === this)
                    return true;
            }
            return false;
        };

        // This function is long and complicated because it is a heavy hitter both in usefulness
        // and performance cost.
        Meta_Object.prototype.get_connections = function () {
            var filters = [];
            for (var _i = 0; _i < (arguments.length - 0); _i++) {
                filters[_i] = arguments[_i + 0];
            }
            var x;
            var first_filter = filters.shift();

            var result = [];
            if (typeof first_filter == 'string') {
                for (x = 0; x < this.internal_connections.length; x++) {
                    if (this.internal_connections[x].type == first_filter) {
                        result.push(this.internal_connections[x].other);
                    }
                }
            } else if (typeof first_filter == 'function') {
                for (x = 0; x < this.internal_connections.length; x++) {
                    if (first_filter(this.internal_connections[x].other)) {
                        result.push(this.internal_connections[x].other);
                    }
                }
            }

            for (var f = 0; f < filters.length; f++) {
                var filter = filters[f];

                if (typeof filter == 'string') {
                    for (x = result.length - 1; x >= 0; x--) {
                        if (this.internal_connections[result[x]].type != filter) {
                            result.splice(x, 1);
                        }
                    }
                } else if (typeof filter == 'function') {
                    for (x = result.length - 1; x >= 0; x--) {
                        if (!filter(result[x])) {
                            result.splice(x, 1);
                        }
                    }
                }
            }

            return result;
        };

        Meta_Object.prototype.get_connection = function (filter) {
            return this.get_connections(filter)[0];
        };

        Meta_Object.prototype.define_connection_getter = function (property_name, connection_name) {
            this[property_name] = function (filter) {
                return this.get_connections(connection_name, filter);
            };
        };

        Meta_Object.prototype.define_object = function (property_name, connection_name) {
            var property = {};
            this[property_name] = property;

            this.listen(this, 'connect.' + connection_name, function (item) {
                property[item.name] = item;
            });

            this.listen(this, 'disconnect.' + connection_name, function (item) {
                delete property[item];
            });
        };

        Meta_Object.prototype.optimize_getter = function (property_name, connection_name) {
            var array = [];
            this[property_name] = array;

            this.listen(this, 'connect.' + connection_name, function (item) {
                array.push(item);
            });

            this.listen(this, 'disconnect.' + connection_name, function (item) {
                MetaHub.remove(array, item);
            });
        };
        return Meta_Object;
    })();
    MetaHub.Meta_Object = Meta_Object;

    var Meta_Connection = (function () {
        function Meta_Connection(parent, other, type) {
            this.type = '';
            this.parent = parent;
            this.other = other;
            this.type = type;
        }
        return Meta_Connection;
    })();
    MetaHub.Meta_Connection = Meta_Connection;
})(MetaHub || (MetaHub = {}));
/**
* User: Chris Johnson
* Date: 9/19/13
*/
/// <reference path="../references.ts"/>
/// <reference path="../../defs/mysql.d.ts"/>
/// <reference path="../../defs/when.d.ts"/>
var when = require('when');

var Ground;
(function (Ground) {
    var Database = (function () {
        function Database(settings, database) {
            this.settings = settings;
            this.database = database;
        }
        Database.prototype.create_table = function (trellis) {
            if (!trellis)
                throw new Error('Empty object was passed to create_table().');

            var table = Ground.Table.create_from_trellis(trellis);
            var sql = table.create_sql_from_trellis(trellis);
            return this.query(sql).then(function () {
                return table;
            });
        };

        Database.prototype.create_tables = function (trellises) {
            var _this = this;
            var promises = MetaHub.map_to_array(trellises, function (trellis) {
                return _this.create_table(trellis);
            });
            return when.all(promises);
        };

        Database.prototype.drop_all_tables = function () {
            var _this = this;
            //      return this.query('SET foreign_key_checks = 0')
            //        .then(when.map(this.get_tables(),(table) => {
            //            console.log('table', table);
            //            return this.query('DROP TABLE IF EXISTS ' + table);
            //          }))
            //        .then(()=> this.query('SET foreign_key_checks = 1'));
            return when.map(this.get_tables(), function (table) {
                //        console.log('table', table);
                return _this.query('DROP TABLE IF EXISTS ' + table);
            });
        };

        Database.prototype.get_tables = function () {
            return when.map(this.query('SHOW TABLES'), function (row) {
                for (var i in row)
                    return row[i];

                return null;
            });
        };

        Database.prototype.query = function (sql, args) {
            if (typeof args === "undefined") { args = undefined; }
            var connection, def = when.defer();
            var mysql = require('mysql');
            connection = mysql.createConnection(this.settings[this.database]);
            connection.connect();

            //      console.log('start', sql)
            connection.query(sql, args, function (err, rows, fields) {
                if (err) {
                    console.log('error', sql);
                    throw err;
                }

                //        console.log('sql', sql)
                def.resolve(rows, fields);

                return null;
            });
            connection.end();

            return def.promise;
        };
        return Database;
    })();
    Ground.Database = Database;
})(Ground || (Ground = {}));
/**
* Created with JetBrains PhpStorm.
* User: Chris Johnson
* Date: 9/18/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Trellis = (function () {
        function Trellis(name, ground) {
            this.plural = null;
            this.parent = null;
            this.table = null;
            this.name = null;
            this.primary_key = 'id';
            // Property that are specific to this trellis and not inherited from a parent trellis
            this.properties = {};
            // Every property including inherited properties
            this.all_properties = {};
            this.is_virtual = false;
            this.ground = ground;
            this.name = name;
        }
        Trellis.prototype.add_property = function (name, source) {
            var property = new Ground.Property(name, source, this);
            this.properties[name] = property;
            this.all_properties[name] = property;
            return property;
        };

        Trellis.prototype.check_primary_key = function () {
            if (!this.properties[this.primary_key] && this.parent) {
                var property = this.parent.properties[this.parent.primary_key];
                this.properties[this.primary_key] = new Ground.Property(this.primary_key, property.get_data(), this);
            }
        };

        Trellis.prototype.clone_property = function (property_name, target_trellis) {
            if (this.properties[property_name] === undefined)
                throw new Error(this.name + ' does not have a property named ' + property_name + '.');

            target_trellis.add_property(property_name, this.properties[property_name]);
        };

        Trellis.prototype.get_all_links = function (filter) {
            if (typeof filter === "undefined") { filter = null; }
            var result = {};
            var properties = this.get_all_properties();
            for (var name in properties) {
                var property = properties[name];
                if (property.other_trellis && (!filter || filter(property)))
                    result[property.name] = property;
            }

            return result;
        };

        Trellis.prototype.get_all_properties = function () {
            var result = {};
            var tree = this.get_tree();
            for (var i = 0; i < tree.length; ++i) {
                var trellis = tree[i];
                for (var name in trellis.properties) {
                    var property = trellis.properties[name];
                    result[property.name] = property;
                }
            }
            return result;
        };

        Trellis.prototype.get_core_properties = function () {
            var result = [];
            for (var i in this.properties) {
                var property = this.properties[i];
                if (property.type != 'list')
                    result[i] = property;
            }

            return result;
            //      return Enumerable.From(this.properties).Where(
            //        (p) => p.type != 'list'
            //      );
        };

        Trellis.prototype.get_join = function (main_table) {
            if (!this.parent)
                return null;

            return 'JOIN  ' + this.parent.get_table_query() + ' ON ' + this.parent.query_primary_key() + ' = ' + main_table + '.' + this.properties[this.primary_key].get_field_name();
        };

        Trellis.prototype.get_links = function () {
            var result = [];
            for (var name in this.properties) {
                var property = this.properties[name];
                if (property.other_trellis)
                    result.push(property);
            }
            return result;
        };

        Trellis.prototype.get_plural = function () {
            return this.plural || this.name + 's';
        };

        Trellis.prototype.get_table_name = function () {
            if (this.is_virtual) {
                if (this.parent) {
                    return this.parent.get_table_name();
                } else {
                    throw new Error('Cannot query trellis ' + this.name + ' since it is virtual and has no parent');
                }
            }
            if (this.table) {
                if (this.table.db_name)
                    return this.table.db_name + '.' + this.table.name;
else
                    return this.table.name;
            }
            if (this.plural)
                return this.plural;

            return this.name + 's';
        };

        Trellis.prototype.get_table_query = function () {
            if (this.table && this.table.query)
                return this.table.query;

            return this.get_table_name();
        };

        Trellis.prototype.get_tree = function () {
            var trellis = this;
            var tree = [];

            do {
                tree.unshift(trellis);
            } while(trellis = trellis.parent);

            return tree;
        };

        Trellis.prototype.load_from_object = function (source) {
            for (var name in source) {
                if (name != 'name' && name != 'properties' && this[name] !== undefined && source[name] !== undefined) {
                    this[name] = source[name];
                }
            }

            for (name in source.properties) {
                this.add_property(name, source.properties[name]);
            }
        };

        Trellis.prototype.query_primary_key = function () {
            return this.get_table_name() + '.' + this.properties[this.primary_key].get_field_name();
        };

        Trellis.prototype.sanitize_property = function (property) {
            if (typeof property === 'string') {
                var properties = this.get_all_properties();
                if (properties[property] === undefined)
                    throw new Error(this.name + ' does not contain a property named ' + property + '.');

                return properties[property];
            }

            return property;
        };

        Trellis.prototype.set_parent = function (parent) {
            this.parent = parent;

            if (!parent.primary_key)
                throw new Error(parent.name + ' needs a primary key when being inherited by ' + this.name + '.');

            parent.clone_property(parent.primary_key, this);
            this.primary_key = parent.primary_key;
        };
        return Trellis;
    })();
    Ground.Trellis = Trellis;
})(Ground || (Ground = {}));
/**
* Created with JetBrains PhpStorm.
* User: Chris Johnson
* Date: 9/18/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Query = (function () {
        function Query(trellis, base_path) {
            if (typeof base_path === "undefined") { base_path = null; }
            this.joins = [];
            this.filters = [];
            this.post_clauses = [];
            this.include_links = true;
            this.fields = [];
            this.arguments = {};
            this.expansions = [];
            this.links = [];
            this.trellis = trellis;
            this.ground = trellis.ground;
            this.expansions = this.ground.expansions;
            this.db = this.ground.db;
            this.main_table = trellis.get_table_name();
            if (base_path)
                this.base_path = base_path;
else
                this.base_path = this.trellis.name;
        }
        Query.prototype.add_arguments = function (args) {
            for (var a in args) {
                this.arguments[a] = args[a];
            }
        };

        Query.prototype.add_filter = function (clause, arguments) {
            if (typeof arguments === "undefined") { arguments = null; }
            this.filters.push(clause);
            if (arguments)
                this.add_arguments(arguments);
        };

        Query.prototype.add_property_filter = function (property, value, like) {
            if (typeof value === "undefined") { value = null; }
            if (typeof like === "undefined") { like = false; }
            property = this.trellis.sanitize_property(property);

            var placeholder = ':' + property.name + '_filter';
            if (value === 'null' && property.type != 'string') {
                this.filters.push(property.query() + ' IS NULL');
                return;
            }

            if (value !== null)
                value = this.ground.convert_value(value, property.type);

            if (property.get_relationship() == Ground.Relationships.many_to_many) {
                this.add_property_join(property, placeholder, true);
            } else {
                if (like) {
                    this.filters.push(property.query() + ' LIKE ' + placeholder);
                    if (value !== null)
                        value = '%' + value + '%';
                } else {
                    this.filters.push(property.query() + ' = ' + placeholder);
                }
            }

            if (value !== null) {
                var args = {};
                args[placeholder] = value;
                this.add_arguments(args);
            }
        };

        Query.prototype.add_key_filter = function (value) {
            this.filters.push(this.trellis.query_primary_key() + ' = :primary_key');
            this.add_arguments({ ':primary_key': value });
        };

        Query.prototype.add_field = function (clause, arguments) {
            if (typeof arguments === "undefined") { arguments = null; }
            this.fields.push(clause);
            if (arguments) {
                this.add_arguments(arguments);
            }
        };

        Query.prototype.add_join = function (clause, arguments) {
            if (typeof arguments === "undefined") { arguments = null; }
            this.joins.push(clause);
            if (arguments) {
                this.add_arguments(arguments);
            }
        };

        Query.prototype.add_property_join = function (property, id, reverse) {
            if (typeof reverse === "undefined") { reverse = false; }
            var join = new Ground.Link_Trellis(property);
            var join_sql = join.generate_join(id, reverse);
            this.add_join(join_sql);
        };

        Query.prototype.add_post = function (clause, arguments) {
            if (typeof arguments === "undefined") { arguments = null; }
            this.post_clauses.push(clause);
            if (arguments) {
                this.add_arguments(arguments);
            }
        };

        Query.prototype.add_expansion = function (clause) {
            this.expansions.push(clause);
        };

        Query.prototype.add_link = function (property) {
            property = this.trellis.sanitize_property(property);
            if (this.links[property.name])
                throw new Error(property.name + ' added twice to query.');

            var link = {
                other: property.get_referenced_trellis(),
                property: property
            };

            this.links[property.name] = link;
        };

        Query.prototype.generate_pager = function (offset, limit) {
            if (typeof offset === "undefined") { offset = 0; }
            if (typeof limit === "undefined") { limit = 0; }
            offset = Math.round(offset);
            limit = Math.round(limit);
            if (!offset) {
                if (!limit)
                    return '';
else
                    return ' LIMIT ' + limit;
            } else {
                if (!limit)
                    limit = 18446744073709551615;

                return ' LIMIT ' + offset + ', ' + limit;
            }
        };

        Query.prototype.generate_sql = function (properties) {
            var data = this.get_fields_and_joins(properties);
            var fields = data.fields.concat(this.fields);
            var joins = data.joins.concat(this.joins);

            if (fields.length == 0)
                throw new Error('No authorized fields found for trellis ' + this.main_table + '.');

            var sql = 'SELECT ';
            sql += fields.join(",\n");
            sql += "\nFROM " + this.main_table;
            if (joins.length > 0)
                sql += "\n" + joins.join("\n");

            if (this.filters.length > 0)
                sql += "\nWHERE " + this.filters.join(" AND ");

            if (this.post_clauses.length > 0)
                sql += " " + this.post_clauses.join(" ");

            for (var pattern in this.arguments) {
                var value = this.arguments[pattern];
                sql = sql.replace(new RegExp(pattern), Ground.Property.get_field_value_sync(value));
            }
            return sql;
        };

        Query.prototype.get_fields_and_joins = function (properties, include_primary_key) {
            if (typeof include_primary_key === "undefined") { include_primary_key = true; }
            var name, fields = [];
            var trellises = {};
            for (name in properties) {
                var property = properties[name];

                if (property.type == 'list' || property.is_virtual)
                    continue;

                if (property.name != this.trellis.primary_key || include_primary_key) {
                    var field_name = property.get_field_name();
                    var sql = property.query();
                    if (field_name != property.name)
                        sql += ' AS `' + property.name + '`';

                    fields.push(sql);
                    trellises[property.parent.name] = property.parent;
                }
            }
            var joins = [];
            for (name in trellises) {
                var trellis = trellises[name];
                var join = trellis.get_join(this.main_table);
                if (join)
                    joins.push(join);
            }

            return {
                fields: fields,
                joins: joins
            };
        };

        Query.prototype.get_many_list = function (id, property, relationship) {
            var other_property = property.get_other_property();
            var query = new Query(other_property.parent, this.get_path(property.name));
            query.include_links = false;
            query.expansions = this.expansions;
            if (relationship === Ground.Relationships.many_to_many)
                query.add_property_join(property, id);
else if (relationship === Ground.Relationships.one_to_many)
                query.add_property_filter(other_property, id);

            return query.run();
        };

        Query.prototype.get_path = function () {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 0); _i++) {
                args[_i] = arguments[_i + 0];
            }
            var items = [];
            if (this.base_path)
                items.push(this.base_path);

            items = items.concat(args);

            return items.join('/');
        };

        Query.prototype.get_reference_object = function (row, property) {
            var query = new Query(property.other_trellis, this.get_path(property.name));
            query.include_links = false;
            query.expansions = this.expansions;
            query.add_filter(property.other_trellis.query_primary_key() + ' = ' + row[property.name]);
            return query.run().then(function (rows) {
                return rows[0];
            });
        };

        Query.prototype.has_expansion = function (path) {
            for (var i = 0; i < this.expansions.length; ++i) {
                var expansion = this.expansions[i];

                if (expansion[0] == '/' && expansion[expansion.length - 1] == '/') {
                    if (path.match(new RegExp(expansion)))
                        return true;
                } else {
                    if (path == expansion)
                        return true;
                }
            }

            return false;
        };

        Query.prototype.process_row = function (row, authorized_properties) {
            if (typeof authorized_properties === "undefined") { authorized_properties = null; }
            var _this = this;
            var name, property, promise, promises = [];

            for (name in this.trellis.properties) {
                property = this.trellis.properties[name];
                var field_name = property.get_field_name();
                if (property.name != field_name && row[field_name] !== undefined) {
                    row[property] = row[field_name];
                    delete row[field_name];
                }
            }

            if (authorized_properties) {
                for (name in authorized_properties) {
                    property = authorized_properties[name];
                    if (row[property.name] !== undefined)
                        row[property.name] = this.ground.convert_value(row[property.name], property.type);
                }
            }

            var links = this.trellis.get_all_links(function (p) {
                return !p.is_virtual;
            });

            for (name in links) {
                property = links[name];

                var path = this.get_path(property.name);
                if (authorized_properties && authorized_properties[name] === undefined)
                    continue;

                if (this.include_links || this.has_expansion(path)) {
                    var id = row[property.parent.primary_key];
                    var relationship = property.get_relationship();

                    switch (relationship) {
                        case Ground.Relationships.one_to_one:
                            promise = this.get_reference_object(row, property);
                            break;
                        case Ground.Relationships.one_to_many:
                        case Ground.Relationships.many_to_many:
                            promise = this.get_many_list(id, property, relationship);
                            break;
                    }

                    promise = promise.then(function (value) {
                        return row[name] = value;
                    });
                    promises.push(promise);
                }
            }

            return when.all(promises).then(function () {
                return _this.ground.invoke(_this.trellis.name + '.process.row', row, _this, _this.trellis);
            }).then(function () {
                return row;
            });
        };

        Query.prototype.run = function (args) {
            if (typeof args === "undefined") { args = {}; }
            var _this = this;
            var properties = this.trellis.get_all_properties();
            var sql = this.generate_sql(properties);
            sql = sql.replace(/\r/g, "\n");
            if (Query.log_queries)
                console.log('query', sql);

            var args = MetaHub.values(this.arguments).concat(args);
            return this.db.query(sql).then(function (rows) {
                return when.all(rows.map(function (row) {
                    return _this.process_row(row, properties);
                }));
            });
        };

        Query.prototype.run_as_service = function (arguments) {
            if (typeof arguments === "undefined") { arguments = {}; }
            var _this = this;
            var properties = this.trellis.get_all_properties();
            var sql = this.generate_sql(properties);
            sql = sql.replace(/\r/g, "\n");
            if (Query.log_queries)
                console.log('query', sql);

            var args = MetaHub.values(this.arguments).concat(arguments);
            return this.db.query(sql).then(function (rows) {
                return when.all(rows.map(function (row) {
                    return _this.process_row(row, properties);
                }));
            }).then(function (rows) {
                return {
                    objects: rows
                };
            });
        };
        Query.log_queries = false;
        return Query;
    })();
    Ground.Query = Query;
})(Ground || (Ground = {}));
/**
* User: Chris Johnson
* Date: 9/23/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Update = (function () {
        function Update(trellis, seed, ground) {
            if (typeof ground === "undefined") { ground = null; }
            this.override = true;
            this.main_table = 'node';
            this.is_service = false;
            this.seed = seed;
            this.trellis = trellis;
            this.main_table = this.trellis.get_table_name();
            this.ground = ground || this.trellis.ground;
            this.db = ground.db;
        }
        Update.prototype.generate_sql = function (trellis) {
            var _this = this;
            var duplicate = '', primary_keys;
            var id = this.seed[trellis.primary_key];
            if (!id && id !== 0) {
                return this.create_record(trellis);
            } else {
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

                var sql = 'SELECT ' + primary_keys.join(', ') + ' FROM ' + trellis.get_table_name() + ' WHERE ' + condition_string;

                return this.db.query(sql).then(function (id_result) {
                    if (!id_result)
                        return _this.create_record(trellis);
else
                        return _this.update_record(trellis, id, condition_string);
                });
            }
        };

        Update.prototype.create_record = function (trellis) {
            var _this = this;
            var fields = [];
            var values = [];
            var core_properties = trellis.get_core_properties();
            var promises = [];
            for (var name in core_properties) {
                var property = core_properties[name];
                if (this.seed[property.name] !== undefined || this.is_create_property(property)) {
                    //          console.log('field', name, this.seed[property.name])
                    fields.push('`' + property.get_field_name() + '`');
                    var field_promise = this.get_field_value(property).then(function (value) {
                        if (value.length == 0) {
                            throw new Error('Field value was empty for inserting ' + property.name + ' in ' + trellis.name + '.');
                        }

                        //            console.log('  ', name, value)
                        values.push(value);
                    });

                    promises.push(field_promise);
                }
            }

            return when.all(promises).then(function () {
                var field_string = fields.join(', ');
                var value_string = values.join(', ');
                var sql = 'INSERT INTO ' + trellis.get_table_name() + ' (' + field_string + ') VALUES (' + value_string + ");\n";
                if (Update.log_queries)
                    console.log(sql);

                return _this.db.query(sql).then(function (result) {
                    //              console.log(arguments)
                    var id;
                    if (_this.seed[trellis.primary_key]) {
                        id = _this.seed[trellis.primary_key];
                    } else {
                        id = result.insertId;
                        _this.seed[trellis.primary_key] = id;
                    }

                    return _this.update_links(trellis, id, true).then(function () {
                        return _this.ground.invoke(trellis.name + '.create', _this.seed, trellis);
                    });
                });
            });
        };

        Update.prototype.update_record = function (trellis, id, key_condition) {
            var _this = this;
            var updates = [];
            var promises = [];
            var core_properties = MetaHub.filter(trellis.get_core_properties(), this.is_update_property);
            for (var name in core_properties) {
                var property = core_properties[name];
                if (this.seed[property.name] !== undefined) {
                    var field_string = '`' + property.get_field_name() + '`';
                    promises.push(this.get_field_value(property).then(function (value) {
                        updates.push(field_string + ' = ' + value);
                    }));
                }
            }

            return when.all(promises).then(function () {
                var next = function () {
                    return _this.update_links(trellis, id).then(function () {
                        return _this.ground.invoke(trellis.name + '.updated', _this.seed, trellis);
                    });
                };

                if (updates.length === 0)
                    return next();

                var sql = 'UPDATE ' + trellis.get_table_name() + "\n" + 'SET ' + updates.join(', ') + "\n" + 'WHERE ' + key_condition + "\n;";

                if (Update.log_queries)
                    console.log(sql);

                return _this.db.query(sql).then(next);
            });
        };

        Update.prototype.apply_insert = function (property, value) {
            if (property.insert == 'trellis')
                return this.trellis.name;

            if (property.type == 'created' || property.type == 'modified')
                return Math.round(new Date().getTime() / 1000).toString();

            if (!value && property.insert == 'author') {
                throw new Error('Inserting author not yet supported');
            }

            return value.toString();
        };

        Update.prototype.is_create_property = function (property) {
            if (property.is_virtual)
                return false;

            // Ignore shared fields
            var field = property.get_field_override();
            if (field && field.share)
                return false;

            return property.insert == 'trellis' || property.type == 'created' || property.type == 'modified' || property.insert == 'author';
        };

        Update.prototype.get_field_value = function (property) {
            var value = this.seed[property.name];
            value = this.apply_insert(property, value);
            this.seed[property.name] = value;

            return property.get_field_value(value, this.is_service);
        };

        Update.prototype.is_update_property = function (property) {
            if (property.is_virtual)
                return false;

            // Ignore shared fields
            var field = property.get_field_override();
            if (field && field.share)
                return false;

            if (property.name == property.parent.primary_key || property.type == 'created' || property.insert == 'alter')
                return false;

            return this.seed[property.name] !== undefined || property.insert == 'trellis' || property.type == 'modified';
        };

        Update.prototype.update_links = function (trellis, id, create) {
            if (typeof create === "undefined") { create = false; }
            var links = trellis.get_links();
            var promises = [];
            for (var name in links) {
                var property = links[name];
                if (this.is_service && !create) {
                    if (property.is_readonly || property.is_private)
                        continue;
                }

                switch (property.get_relationship()) {
                    case Ground.Relationships.one_to_many:
                        promises.push(this.update_one_to_many(property, id));
                        break;
                    case Ground.Relationships.many_to_many:
                        promises.push(this.update_many_to_many(property, id, create));
                        break;
                }
            }

            return when.all(promises);
        };

        Update.prototype.update_many_to_many = function (property, id, create) {
            if (typeof create === "undefined") { create = false; }
            var list = this.seed[property.name];
            if (!MetaHub.is_array(list))
                return when.resolve();

            throw new Error('Not yet implemented');
        };

        Update.prototype.update_one_to_many = function (property, id) {
            var _this = this;
            var seed = this.seed;
            var list = seed[property.name];
            if (!MetaHub.is_array(list))
                return when.resolve();

            var promises = MetaHub.map_to_array(list, function (item) {
                return _this.update_reference_object(item, property, id);
            });

            return when.all(promises);
        };

        Update.prototype.update_reference = function (property, id) {
            var item = this.seed[property.name];
            if (!item)
                return when.resolve();

            return this.update_reference_object(item, property, id);
        };

        Update.prototype.update_reference_object = function (object, property, id) {
            var trellis;
            if (object.trellis)
                trellis = object.trellis;
else
                trellis = property.other_trellis;

            var other_property = property.get_other_property();
            if (other_property && object[other_property.name] !== undefined)
                object[other_property.name] = id;

            return this.ground.update_object(trellis, object);
        };

        Update.prototype.run = function () {
            var _this = this;
            var tree = this.trellis.get_tree().filter(function (t) {
                return !t.is_virtual;
            });

            var promises = tree.map(function (trellis) {
                return _this.generate_sql(trellis);
            });

            return when.all(promises).then(function () {
                return _this.seed;
            });
        };
        Update.log_queries = false;
        return Update;
    })();
    Ground.Update = Update;
})(Ground || (Ground = {}));
/**
* User: Chris Johnson
* Date: 9/25/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Delete = (function () {
        function Delete() {
        }
        Delete.prototype.run = function (trellis, seed) {
            throw new Error('Not implemented yet.');
        };
        return Delete;
    })();
    Ground.Delete = Delete;
})(Ground || (Ground = {}));
/**
* Created with JetBrains PhpStorm.
* User: Chris Johnson
* Date: 9/18/13
*/
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
/// <reference path="../references.ts"/>
/// <reference path="../db/Database.ts"/>
/// <reference path="../schema/Trellis.ts"/>
/// <reference path="../operations/Query.ts"/>
/// <reference path="../operations/Update.ts"/>
/// <reference path="../operations/Delete.ts"/>
/// <reference path="../../defs/node.d.ts"/>
//var MetaHub = require('metahub');
var Ground;
(function (Ground) {
    var Property_Type = (function () {
        function Property_Type(name, info, types) {
            if (info.parent) {
                var parent = types[info.parent];
                MetaHub.extend(this, parent);
                this.parent = parent;
            } else {
                this.field_type = info.field_type;
            }

            this.name = name;
            this.property_class = 'Property';
            if (info.default) {
                this.default_value = info.default;
            }
        }
        Property_Type.prototype.get_field_type = function () {
            if (this.field_type) {
                return this.field_type;
            }

            if (this.parent) {
                return this.parent.get_field_type();
            }

            throw new Error(this.name + " could not find valid field type.");
        };
        return Property_Type;
    })();
    Ground.Property_Type = Property_Type;

    var Core = (function (_super) {
        __extends(Core, _super);
        function Core(config, db_name) {
            _super.call(this);
            this.trellises = [];
            this.tables = [];
            this.views = [];
            this.property_types = [];
            this.expansions = [];
            this.db = new Ground.Database(config, db_name);
            var path = require('path');
            var filename = path.resolve(__dirname, 'property_types.json');
            this.load_property_types(filename);
        }
        Core.prototype.add_trellis = function (name, source, initialize_parent) {
            if (typeof initialize_parent === "undefined") { initialize_parent = true; }
            var trellis = new Ground.Trellis(name, this);
            if (source)
                trellis.load_from_object(source);

            this.trellises[name] = trellis;

            if (initialize_parent)
                this.initialize_trellises([trellis], this.trellises);

            return trellis;
        };

        Core.prototype.convert_value = function (value, type) {
            if (!value) {
                if (type == 'bool')
                    return false;

                return null;
            }

            var property_type = this.property_types[type];

            if (property_type && property_type.parent)
                return this.convert_value(value, property_type.parent.name);

            switch (type) {
                case 'list':
                case 'reference':
                    return value;
                case 'int':
                    return Math.round(value);
                case 'string':
                case 'text':
                    return value;
                case 'bool':
                    return Core.to_bool(value);
                case 'float':
                case 'double':
                case 'money':
                    return parseFloat(value.toString());
            }

            return null;
        };

        //    create_query(trellis:Trellis, base_path = '') {
        //      return new Query(trellis, base_path);
        //    }
        Core.prototype.create_query = function (trellis_name, base_path) {
            if (typeof base_path === "undefined") { base_path = ''; }
            var trellis = this.sanitize_trellis_argument(trellis_name);

            return new Ground.Query(trellis, base_path);
        };

        Core.prototype.delete_object = function (trellis, seed) {
            var trellis = this.sanitize_trellis_argument(trellis);
            var del = new Ground.Delete();
            return del.run(trellis, seed);
        };

        Core.prototype.initialize_trellises = function (subset, all) {
            if (typeof all === "undefined") { all = null; }
            all = all || subset;

            for (var i in subset) {
                var trellis = subset[i];
                if (typeof trellis.parent === 'string') {
                    trellis.set_parent(all[trellis.parent]);
                    trellis.check_primary_key();
                }

                for (var j in trellis.properties) {
                    var property = trellis.properties[j];
                    if (property.other_trellis_name)
                        property.other_trellis = this.trellises[property.other_trellis_name];
                }
            }
        };

        Core.prototype.insert_object = function (trellis, seed) {
            if (typeof seed === "undefined") { seed = {}; }
            return this.update_object(trellis, seed);
        };

        Core.is_private = function (property) {
            return property.is_private;
        };

        Core.is_private_or_readonly = function (property) {
            return property.is_private || property.is_readonly;
        };

        Core.prototype.update_object = function (trellis, seed, as_service) {
            if (typeof seed === "undefined") { seed = {}; }
            if (typeof as_service === "undefined") { as_service = false; }
            var trellis = this.sanitize_trellis_argument(trellis);

            if (seed._deleted === true || seed._deleted === 'true')
                return this.delete_object(trellis, seed);

            this.invoke(trellis.name + '.update', seed, trellis);
            var update = new Ground.Update(trellis, seed, this);
            update.is_service = as_service;
            return update.run();
        };

        Core.load_json_from_file = function (filename) {
            var fs = require('fs');
            var json = fs.readFileSync(filename, 'ascii');
            if (!json)
                throw new Error('Could not find file: ' + filename);

            return JSON.parse(json);
        };

        Core.prototype.load_property_types = function (filename) {
            var property_types = Core.load_json_from_file(filename);
            for (var name in property_types) {
                var info = property_types[name];
                var type = new Property_Type(name, info, this.property_types);
                this.property_types[name] = type;
            }
        };

        Core.prototype.load_schema_from_file = function (filename) {
            var data = Core.load_json_from_file(filename);
            this.parse_schema(data);
        };

        Core.prototype.load_tables = function (tables) {
            for (var name in tables) {
                var table_name;

                //        var trellis = this.trellises[name];
                //        if (trellis)
                //          table_name = trellis.get_table_name();
                //        else
                //          table_name = name;
                var table = new Ground.Table(name, this);
                table.load_from_schema(tables[name]);
                this.tables[name] = table;
            }
        };

        Core.prototype.load_trellises = function (trellises) {
            var subset = [];
            for (var name in trellises) {
                var trellis = this.add_trellis(name, trellises[name], false);
                subset[name] = trellis;
            }

            this.initialize_trellises(subset, this.trellises);
        };

        Core.prototype.parse_schema = function (data) {
            if (data.trellises)
                this.load_trellises(data.trellises);

            if (data.views)
                this.views = this.views.concat(data.views);

            if (data.tables)
                this.load_tables(data.tables);
        };

        Core.remove_fields = function (object, trellis, filter) {
            for (var key in object) {
                var property = trellis.properties[key];
                if (property && filter(property))
                    delete object[key];
            }
            return object;
        };

        Core.prototype.sanitize_trellis_argument = function (trellis) {
            if (!trellis)
                throw new Error('Trellis is empty');

            if (typeof trellis === 'string') {
                if (!this.trellises[trellis])
                    throw new Error('Could not find trellis named: ' + trellis + '.');

                return this.trellises[trellis];
            }

            return trellis;
        };

        Core.to_bool = function (input) {
            if (typeof input == 'string') {
                return input.toLowerCase() == 'true';
            }

            return !!input;
        };
        return Core;
    })(MetaHub.Meta_Object);
    Ground.Core = Core;
})(Ground || (Ground = {}));

module.exports = Ground;
/**
* User: Chris Johnson
* Date: 9/19/13
*/
/// <reference path="../references.ts"/>
/// <reference path="../../../metahub/metahub.ts"/>
var Ground;
(function (Ground) {
    var Table = (function () {
        function Table(name, ground) {
            this.properties = [];
            this.name = name;
            this.ground = ground;
        }
        Table.prototype.connect_trellis = function (trellis) {
            this.trellis = trellis;
            trellis.table = this;
        };

        Table.create_from_trellis = function (trellis, ground) {
            if (typeof ground === "undefined") { ground = null; }
            if (trellis.table)
                return trellis.table;

            ground = ground || trellis.ground;

            var table = new Table(trellis.get_table_name(), ground);
            table.connect_trellis(trellis);
            return table;
        };

        Table.create_sql_from_array = function (table_name, source, primary_keys, indexes) {
            if (typeof primary_keys === "undefined") { primary_keys = []; }
            if (typeof indexes === "undefined") { indexes = []; }
            var fields = MetaHub.map_to_array(source, function (field, index) {
                var name = field.name || index;
                var type = field.type;

                if (!type)
                    throw new Error('Field ' + name + 'is missing a type.');

                var field_sql = '`' + name + '` ' + type;
                if (primary_keys.indexOf(name) > -1) {
                    if (type.search(/INT/) > -1 && primary_keys[0] == name)
                        field_sql += ' AUTO_INCREMENT';
                }
                if (field.default !== undefined)
                    field_sql += ' DEFAULT ' + Table.format_value(field.default);

                return field_sql;
            });

            if (fields.length == 0) {
                if (source.length > 0)
                    throw new Error('None of the field arguments for creating ' + table_name + ' have a type.');
else
                    throw new Error('Cannot creat a table without fields: ' + table_name + '.');
            }

            var primary_fields = MetaHub.map_to_array(primary_keys, function (key) {
                return '`' + key + '`';
            });
            fields.push('PRIMARY KEY (' + primary_fields.join(', ') + ")\n");
            fields = fields.concat(MetaHub.map_to_array(indexes, function (index, key) {
                return Table.generate_index_sql(key, index);
            }));
            var sql = 'CREATE TABLE IF NOT EXISTS `' + table_name + "` (\n";
            sql += fields.join(",\n") + "\n";
            sql += ");\n";
            return sql;
        };

        Table.prototype.create_sql_from_trellis = function (trellis) {
            var primary_keys;
            if (!trellis) {
                if (!this.trellis)
                    throw new Error('No valid trellis to generate sql from.');

                trellis = this.trellis;
            }

            var core_properties = trellis.get_core_properties();
            if (Object.keys(core_properties).length === 0)
                throw new Error('Cannot create a table for ' + trellis.name + '. It does not have any core properties.');

            var fields = [];
            for (var name in core_properties) {
                var property = core_properties[name];
                var field_test = this.properties[property.name];

                if (field_test && field_test.share)
                    continue;

                var field = {
                    name: property.get_field_name(),
                    type: property.get_field_type(),
                    default: undefined
                };

                if (property.default !== undefined)
                    field.default = property.default;

                fields.push(field);
            }

            if (this.primary_keys && this.primary_keys.length > 0) {
                primary_keys = this.primary_keys.map(function (name) {
                    if (!trellis.properties[name])
                        throw new Error('Error creating ' + trellis.name + '; it does not have a primary key named ' + name + '.');

                    return trellis.properties[name].get_field_name();
                });
            } else {
                primary_keys = [trellis.properties[trellis.primary_key].get_field_name()];
            }

            return Table.create_sql_from_array(this.name, fields, primary_keys, this.indexes);
        };

        Table.format_value = function (value) {
            if (typeof value === 'string')
                return "'" + value + "'";

            if (value === null)
                return 'NULL';

            if (value === true)
                return 'TRUE';

            if (value === false)
                return 'FALSE';

            return value;
        };

        Table.generate_index_sql = function (name, index) {
            var name_string, index_fields = index.fields.join('`, `');
            var result = '';

            if (index.unique) {
                result += 'UNIQUE ';
                name_string = '';
            } else {
                name_string = '`' + name + '`';
            }

            result += "KEY " + name_string + ' (`' + index_fields + "`)\n";
            return result;
        };

        Table.prototype.load_from_schema = function (source) {
            var name = this.name;
            MetaHub.extend(this, source);
            if (this.ground.trellises[name]) {
                this.trellis = this.ground.trellises[name];
                this.trellis.table = this;
                if (!source.name)
                    this.name = this.trellis.get_plural();
            }
        };
        return Table;
    })();
    Ground.Table = Table;
})(Ground || (Ground = {}));
/**
* User: Chris Johnson
* Date: 10/1/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Link_Trellis = (function () {
        function Link_Trellis(property) {
            this.id_suffix = '';
            this.property = property;
            this.args = this.get_arguments(property);
        }
        Link_Trellis.prototype.generate_join = function (id, reverse) {
            if (typeof reverse === "undefined") { reverse = false; }
            var sql;
            if (reverse) {
                sql = "JOIN %table_name ON %table_name.%second_key = %forward_id" + " AND %table_name.%first_key = " + id + "\n";
            } else {
                sql = "JOIN %table_name ON %table_name.%second_key = " + id + " AND %table_name.%first_key = %back_id\n";
            }

            return Link_Trellis.populate_sql(sql, this.args);
        };
        Link_Trellis.prototype.get_arguments = function (property) {
            var other_property = property.get_other_property();
            var first_key, second_key;

            // Since we are checking for an ideal cross table name,
            // Use plural trellis names isntead of any table name overrides.
            var other_table = other_property.parent.get_plural();
            var temp = [other_table, property.parent.get_plural()];
            temp = temp.sort();
            this.table_name = temp.join('_');
            var result = {
                '%first_id': property.query(),
                '%second_id': other_property.query(),
                '%back_id': other_property.parent.query_primary_key(),
                '%forward_id': property.parent.query_primary_key()
            };

            var ground = property.parent.ground;
            var table = ground.tables[this.table_name];
            if (table && Object.keys(table.properties).length >= 2) {
                for (var name in table.properties) {
                    var field = table.properties[name];
                    if (field.trellis === property.trellis)
                        first_key = name;
else if (field.trellis === other_property.other_trellis)
                        second_key = name;
                }

                if (!first_key || !second_key)
                    throw new Error('Properties do not line up for cross table: ' + this.table_name + '.');

                MetaHub.extend(result, {
                    '%table_name': table.name,
                    '%first_key': first_key,
                    '%second_key': second_key
                });
            } else {
                MetaHub.extend(result, {
                    '%table_name': this.table_name,
                    '%first_key': property.parent.name + this.id_suffix,
                    '%second_key': other_property.parent.name + this.id_suffix
                });
            }

            return result;
        };

        Link_Trellis.populate_sql = function (sql, args) {
            var result = sql;
            for (var a in args) {
                result = result.replace(new RegExp(a, 'g'), args[a]);
            }
            return result;
        };
        return Link_Trellis;
    })();
    Ground.Link_Trellis = Link_Trellis;
})(Ground || (Ground = {}));
/**
* Created with JetBrains PhpStorm.
* User: Chris Johnson
* Date: 9/18/13
* Time: 5:40 PM
*/
/// <reference path="../references.ts"/>
/// <reference path="../../defs/when.d.ts"/>
var Ground;
(function (Ground) {
    (function (Relationships) {
        Relationships[Relationships["one_to_one"] = 0] = "one_to_one";
        Relationships[Relationships["one_to_many"] = 1] = "one_to_many";
        Relationships[Relationships["many_to_many"] = 2] = "many_to_many";
    })(Ground.Relationships || (Ground.Relationships = {}));
    var Relationships = Ground.Relationships;

    var Property = (function () {
        function Property(name, source, trellis) {
            this.name = null;
            this.parent = null;
            this.type = null;
            this.is_readonly = false;
            this.insert = null;
            this.other_property = null;
            this.default = null;
            this.other_trellis = null;
            this.other_trellis_name = null;
            this.is_private = false;
            this.is_virtual = false;
            for (var i in source) {
                if (this.hasOwnProperty(i))
                    this[i] = source[i];
            }

            if (source.trellis) {
                this.other_trellis_name = source.trellis;
            }

            this.name = name;
            this.parent = trellis;
        }
        Property.prototype.get_data = function () {
            var result = {
                type: this.type
            };
            if (this.other_trellis_name)
                result.trellis = this.other_trellis_name;

            if (this.is_readonly)
                result.is_readonly = this.is_readonly;

            if (this.is_private)
                result.is_private = this.is_private;

            if (this.insert)
                result.insert = this.insert;

            return result;
        };

        Property.prototype.get_field_name = function () {
            var field = this.get_field_override();
            if (field) {
                if (field.name)
                    return field.name;

                if (field.share)
                    return field.share;
            }

            return this.name;
        };

        Property.prototype.get_field_override = function (create_if_missing) {
            if (typeof create_if_missing === "undefined") { create_if_missing = false; }
            var table = this.parent.table;
            if (!table) {
                if (!create_if_missing)
                    return null;

                table = Ground.Table.create_from_trellis(this.parent);
            }

            if (table.properties[this.name] === undefined) {
                if (!create_if_missing)
                    return null;

                table.properties[this.name] = {};
            }

            return table.properties[this.name];
        };

        Property.prototype.get_field_type = function () {
            var property_type = this.get_property_type();
            if (!property_type)
                throw new Error(this.name + ' could not find valid field type: ' + this.type);

            return property_type.get_field_type();
        };

        Property.get_field_value_sync = function (value) {
            if (typeof value === 'string') {
                value = value.replace(/'/g, "\\'", value);
                value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
                //        console.log('value', value)
            } else if (value === true)
                value = 'TRUE';
else if (value === false)
                value = 'FALSE';
            if (value === null || value === undefined)
                value = 'NULL';

            return value;
        };

        Property.prototype.get_field_value = function (value, as_service) {
            if (typeof as_service === "undefined") { as_service = false; }
            var _this = this;
            if (typeof value === 'string')
                value = value.replace(/'/g, "\\'", value);

            if (value === true)
                value = 'TRUE';
else if (value === false)
                value = 'FALSE';
            if (value === null || value === undefined)
                value = 'NULL';
else if (this.type == 'string' || this.type == 'text') {
                value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
            } else if (this.type == 'reference' && typeof value === 'object') {
                //        console.log(value.other_trellis, this.other_trellis.name)
                var trellis = this.other_trellis;
                var ground = this.parent.ground;

                return ground.update_object(trellis, value, as_service).then(function (entity) {
                    var other_id = _this.get_other_id(value);
                    if (other_id !== null)
                        value = other_id;
else
                        value = entity[trellis.primary_key];

                    if (value === null || value === undefined)
                        value = 'NULL';

                    return value;
                });
            }

            return when.resolve(value);
        };

        Property.prototype.get_other_id = function (entity) {
            var value = entity[this.other_trellis.primary_key];
            if (value === undefined)
                value = null;

            return value;
        };

        Property.prototype.get_other_property = function (create_if_none) {
            if (typeof create_if_none === "undefined") { create_if_none = true; }
            var property;
            if (this.other_property) {
                return this.other_trellis.properties[this.other_property];
            } else {
                for (var name in this.other_trellis.properties) {
                    property = this.other_trellis.properties[name];
                    if (property.other_trellis === this.parent) {
                        return property;
                    }
                }
            }

            if (this.other_trellis === this.parent)
                return null;

            if (!create_if_none)
                return null;

            // If there is no existing connection defined in this trellis, create a dummy
            // connection and assume that it is a list.  This means that implicit connections
            // are either one-to-many or many-to-many, never one-to-one.
            var attributes = {};
            attributes.type = 'list';
            attributes.trellis = this.parent.name;
            return new Property('_' + this.other_trellis.name, attributes, this.other_trellis);
        };

        Property.prototype.get_property_type = function () {
            var types = this.parent.ground.property_types;
            if (types[this.type] !== undefined)
                return types[this.type];

            return null;
        };

        Property.prototype.get_referenced_trellis = function () {
            return this.other_trellis;
        };

        Property.prototype.get_relationship = function () {
            var field = this.get_field_override();
            if (field && field.relationship) {
                return Relationships[field.relationship];
            }

            var other_property = this.get_other_property();
            if (!other_property)
                throw new Error(this.parent.name + '.' + this.name + ' does not have a reciprocal reference.');

            if (this.type == 'list') {
                if (other_property.type == 'list')
                    return Relationships.many_to_many;
else
                    return Relationships.one_to_many;
            }
            return Relationships.one_to_one;
        };

        Property.prototype.query = function () {
            return this.parent.get_table_name() + '.' + this.get_field_name();
        };
        return Property;
    })();
    Ground.Property = Property;
})(Ground || (Ground = {}));
/**
* User: Chris Johnson
* Date: 10/3/13
*/
/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Irrigation = (function () {
        function Irrigation(ground) {
            this.ground = ground;
        }
        Irrigation.prototype.query = function (request) {
            var trellis = this.ground.sanitize_trellis_argument(request.trellis);
            var query = new Ground.Query(trellis);

            return query.run();
        };

        Irrigation.prototype.update = function (request) {
            var promises = [];

            if (!request.objects)
                throw new Error('Request requires an objects array.');

            for (var i = 0; i < request.objects.length; ++i) {
                var object = request.objects[i];
                var promise = this.ground.update_object(object.trellis, object);
                promises.push(promise);
            }

            return when.all(promises);
        };
        return Irrigation;
    })();
    Ground.Irrigation = Irrigation;
})(Ground || (Ground = {}));
/**
* User: Chris Johnson
* Date: 9/19/13
*/
/// <reference path="core/require.ts"/>
/// <reference path="../defs/when.d.ts"/>
/// <reference path="../defs/linq.d.ts"/>
/// <reference path="../../metahub/metahub.ts"/>
/// <reference path="core/Core.ts"/>
/// <reference path="db/Table.ts"/>
/// <reference path="db/Link_Trellis.ts"/>
/// <reference path="schema/Property.ts"/>
/// <reference path="schema/Trellis.ts"/>
/// <reference path="operations/Query.ts"/>
/// <reference path="operations/Update.ts"/>
/// <reference path="operations/Delete.ts"/>
/// <reference path="services/Irrigation.ts"/>
require('source-map-support').install();
//# sourceMappingURL=ground.js.map