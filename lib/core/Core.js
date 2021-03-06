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
    function path_to_array(path) {
        if (MetaHub.is_array(path))
            return path;

        path = path.trim();

        if (!path)
            throw new Error('Empty query path.');

        return path.split('/');
    }
    Ground.path_to_array = path_to_array;

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
            this.log_queries = false;
            this.log_updates = false;
            this.db = new Ground.Database(config, db_name);
            var path = require('path');
            var filename = path.resolve(__dirname, 'property_types.json');
            this.load_property_types(filename);
        }
        Core.prototype.add_trellis = function (name, source, initialize_parent) {
            if (typeof initialize_parent === "undefined") { initialize_parent = true; }
            var trellis = this.trellises[name];

            if (trellis) {
                trellis = this.trellises[name];
                if (source)
                    trellis.load_from_object(source);

                return trellis;
            }

            trellis = new Ground.Trellis(name, this);
            if (source)
                trellis.load_from_object(source);

            this.trellises[name] = trellis;

            if (initialize_parent)
                this.initialize_trellises([trellis], this.trellises);

            return trellis;
        };

        Core.prototype.get_base_property_type = function (type) {
            var property_type = this.property_types[type];
            if (property_type.parent)
                return this.get_base_property_type(property_type.parent.name);

            return property_type;
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
                case 'guid':
                    return value;
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

            throw new Error('Not sure how to convert sql type of ' + type + '.');
            //      return null;
        };

        //    create_query(trellis:Trellis, base_path = '') {
        //      return new Query(trellis, base_path);
        //    }
        Core.prototype.create_query = function (trellis_name, base_path) {
            if (typeof base_path === "undefined") { base_path = ''; }
            var trellis = this.sanitize_trellis_argument(trellis_name);

            return new Ground.Query_Builder(trellis);
        };

        Core.prototype.create_update = function (trellis, seed, user) {
            if (typeof seed === "undefined") { seed = {}; }
            if (typeof user === "undefined") { user = null; }
            trellis = this.sanitize_trellis_argument(trellis);

            // If _deleted is an object then it is a list of links
            // to delete which will be handled by Update.
            // If _delete is simply true then the seed itself is marked for deletion.
            if (seed._deleted === true || seed._deleted === 'true')
                return new Ground.Delete(trellis, seed);

            var update = new Ground.Update(trellis, seed, this);
            update.user = user;
            update.log_queries = this.log_updates;
            return update;
        };

        Core.prototype.delete_object = function (trellis, seed) {
            var trellis = this.sanitize_trellis_argument(trellis);
            var del = new Ground.Delete(trellis, seed);
            return del.run();
        };

        Core.prototype.initialize_trellises = function (subset, all) {
            if (typeof all === "undefined") { all = null; }
            all = all || subset;

            for (var i in subset) {
                var trellis = subset[i];
                trellis.initialize(all);
            }
        };

        Core.prototype.insert_object = function (trellis, seed, user, as_service) {
            if (typeof seed === "undefined") { seed = {}; }
            if (typeof user === "undefined") { user = null; }
            if (typeof as_service === "undefined") { as_service = false; }
            return this.update_object(trellis, seed, user, as_service);
        };

        Core.is_private = function (property) {
            return property.is_private;
        };

        Core.is_private_or_readonly = function (property) {
            return property.is_private || property.is_readonly;
        };

        Core.prototype.update_object = function (trellis, seed, user, as_service) {
            if (typeof seed === "undefined") { seed = {}; }
            if (typeof user === "undefined") { user = null; }
            if (typeof as_service === "undefined") { as_service = false; }
            trellis = this.sanitize_trellis_argument(trellis);

            // If _deleted is an object then it is a list of links
            // to delete which will be handled by Update.
            // If _delete is simply true then the seed itself is marked for deletion.
            if (seed._deleted === true || seed._deleted === 'true')
                return this.delete_object(trellis, seed);

            var update = new Ground.Update(trellis, seed, this);
            update.user = user;
            update.log_queries = this.log_updates;

            //      this.invoke(trellis.name + '.update', seed, trellis);
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

            return subset;
        };

        Core.prototype.parse_schema = function (data) {
            var subset = null;
            if (data.trellises)
                subset = this.load_trellises(data.trellises);

            if (data.views)
                this.views = this.views.concat(data.views);

            if (data.tables)
                this.load_tables(data.tables);

            if (subset)
                this.initialize_trellises(subset, this.trellises);
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
//# sourceMappingURL=Core.js.map
