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
        Relationships[Relationships["none"] = 0] = "none";
        Relationships[Relationships["one_to_one"] = 1] = "one_to_one";
        Relationships[Relationships["one_to_many"] = 2] = "one_to_many";
        Relationships[Relationships["many_to_many"] = 3] = "many_to_many";
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
            this.other_trellis = null;
            this.other_trellis_name = null;
            this.is_private = false;
            this.is_virtual = false;
            this.is_composite_sub = false;
            this.composite_properties = null;
            this.access = 'auto';
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
        Property.prototype.initialize_composite_reference = function (other_trellis) {
            var table = other_trellis.table;
            if (table && table.primary_keys && table.primary_keys.length > 1) {
                for (var i = 0; i < table.primary_keys.length; ++i) {
                    var key = table.primary_keys[i];
                    var name = other_trellis.name + '_' + key;
                    if (key != other_trellis.primary_key) {
                        var other_property = other_trellis.properties[key];
                        var new_property = this.parent.add_property(name, other_property.get_data());
                        new_property.other_property = key;
                        new_property.other_trellis_name = this.parent.name;
                        new_property.other_trellis = this.parent;
                        new_property.is_composite_sub = true;
                        this.composite_properties = this.composite_properties || [];
                        this.composite_properties.push(new_property);
                    }
                }
            }
        };

        Property.prototype.fullname = function () {
            return this.parent.name + '.' + this.name;
        };

        Property.prototype.get_composite = function () {
            if (this.composite_properties)
                return [this].concat(this.composite_properties);

            return [this];
        };

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

        Property.prototype.get_default = function () {
            if (this.default == undefined && this.parent.parent && this.parent.parent.properties[this.name])
                return this.parent.parent.properties[this.name].get_default();

            return this.default;
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
            if (this.type == 'reference') {
                var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key];
                return other_primary_property.get_field_type();
            }
            var property_type = this.get_property_type();
            if (!property_type)
                throw new Error(this.name + ' could not find valid field type: ' + this.type);

            return property_type.get_field_type();
        };

        //    static get_field_value_sync(value) {
        //      if (typeof value === 'string') {
        //        value = value.replace(/'/g, "\\'", value);
        //        value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
        ////        console.log('value', value)
        //      }
        //      else if (value === true)
        //        value = 'TRUE';
        //      else if (value === false)
        //        value = 'FALSE';
        //      if (value === null || value === undefined)
        //        value = 'NULL';
        //
        //      return value;
        //    }
        Property.prototype.get_seed_name = function () {
            if (this.is_composite_sub)
                return this.other_property;
            else
                return this.name;
        };

        Property.prototype.get_sql_value = function (value, type) {
            if (typeof type === "undefined") { type = null; }
            type = type || this.type;
            var property_type = this.parent.ground.property_types[type];
            if (value === undefined || value === null) {
                value = this.get_default();
            }

            if (property_type && property_type.parent)
                return this.get_sql_value(value, property_type.parent.name);

            switch (type) {
                case 'guid':
                    if (!value)
                        return 'NULL';

                    // Strip the guid of hyphens and any invalid characters.  Normalize the case.
                    // Also convert from hex to binary within the SQL.
                    return "UNHEX('" + value.toUpperCase().replace(/[^A-Z0-9]/g, '') + "')";
                case 'list':

                case 'reference':
                    var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key];
                    if (typeof value === 'object') {
                        value = value[this.other_trellis.primary_key];
                        if (!value)
                            return null;
                    }
                    return other_primary_property.get_sql_value(value);

                case 'int':
                    if (!value)
                        return 0;

                    return Math.round(value);
                case 'string':
                case 'text':
                    if (!value)
                        return "''";

                    if (typeof value !== 'string')
                        value = value.toString();

                    value = value.replace(/'/g, "\\'", value);
                    return "'" + value.replace(/[\r\n]+/, "\n") + "'";
                case 'bool':
                    return value ? 'TRUE' : 'FALSE';
                case 'float':
                case 'double':
                    if (!value)
                        return 0;

                    return parseFloat(value);
                case 'money':
                    if (typeof value !== 'number')
                        return parseFloat(value.toString());
            }

            throw new Error('Ground is not configured to process property types of ' + type + ' (' + this.type + ')');
        };

        Property.prototype.get_type = function () {
            if (this.type == 'reference' || this.type == 'list') {
                var other_property = this.get_other_property();
                if (other_property)
                    return other_property.type;

                return this.other_trellis.properties[this.other_trellis.primary_key].type;
            }

            return this.type;
        };

        //    get_field_value(value, as_service:boolean = false, update:boolean = false) {
        //      if (typeof value === 'string')
        //        value = value.replace(/'/g, "\\'", value);
        //
        //      if (value === true)
        //        value = 'TRUE';
        //      else if (value === false)
        //        value = 'FALSE';
        //      if (value === null || value === undefined)
        //        value = 'NULL';
        //      else if (this.type == 'string' || this.type == 'text' || this.type == 'guid') {
        //        value = "'" + value.replace(/[\r\n]+/, "\n") + "'";
        //      }
        //      else if (this.type == 'reference') {
        //        if (typeof value !== 'object') {
        //          var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key]
        //          value = other_primary_property.get_field_value(value, as_service, update)
        //        }
        //      }
        //
        //      return value
        //    }
        Property.prototype.get_other_id = function (entity) {
            var value = entity[this.other_trellis.primary_key];
            if (value === undefined)
                value = null;

            return value;
        };

        Property.prototype.get_other_property = function (create_if_none) {
            if (typeof create_if_none === "undefined") { create_if_none = false; }
            var property;
            if (this.other_property) {
                return this.other_trellis.properties[this.other_property];
            } else {
                if (!this.other_trellis)
                    return null;

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
            attributes.is_virtual = true;
            attributes.trellis = this.parent.name;
            return new Property(this.other_trellis.name, attributes, this.other_trellis);
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
            if (this.type != 'list' && this.type != 'reference')
                return 0 /* none */;

            var field = this.get_field_override();
            if (field && field.relationship) {
                return Relationships[field.relationship];
            }

            var other_property = this.get_other_property();
            if (!other_property) {
                if (this.type == 'list')
                    return 2 /* one_to_many */;
                else
                    return 1 /* one_to_one */;
            }

            //        throw new Error(this.parent.name + '.' + this.name + ' does not have a reciprocal reference.');
            if (this.type == 'list') {
                if (other_property.type == 'list')
                    return 3 /* many_to_many */;
                else
                    return 2 /* one_to_many */;
            }
            return 1 /* one_to_one */;
        };

        Property.prototype.get_field_query = function () {
            var field_name = this.get_field_name();
            var sql = this.query();
            var type = this.get_type();
            if (type == 'guid')
                sql = "INSERT(INSERT(INSERT(INSERT(HEX(" + sql + ")" + ",9,0,'-')" + ",14,0,'-')" + ",19,0,'-')" + ",24,0,'-') AS `" + this.name + '`';
            else if (field_name != this.name)
                sql += ' AS `' + this.name + '`';

            return sql;
        };

        Property.prototype.query = function () {
            return '`' + this.parent.get_table_name() + '`.' + this.get_field_name();
        };
        return Property;
    })();
    Ground.Property = Property;
})(Ground || (Ground = {}));
//# sourceMappingURL=Property.js.map
