var MetaHub = require('vineyard-metahub');var when = require('when');
var mysql = require('mysql');

var Ground;
(function (Ground) {
    var Database = (function () {
        function Database(settings, database) {
            this.log_queries = false;
            this.active = true;
            this.settings = settings;
            this.database = database;
            var mysql = require('mysql');
            this.pool = mysql.createPool(this.settings[this.database]);
        }
        Database.prototype.add_table_to_database = function (table, ground) {
            var sql = table.create_sql(ground);
            return this.query(sql).then(function () {
                return table;
            });
        };

        Database.prototype.add_non_trellis_tables_to_database = function (tables, ground) {
            var _this = this;
            var non_trellises = MetaHub.filter(tables, function (x) {
                return !x.trellis;
            });

            var promises = MetaHub.map_to_array(non_trellises, function (table) {
                return _this.add_table_to_database(table, ground);
            });
            return when.all(promises);
        };

        Database.prototype.start = function () {
            if (this.active)
                return;

            this.pool = mysql.createPool(this.settings[this.database]);
            this.active = true;
            console.log('db-started.');
        };

        Database.prototype.close = function () {
            if (this.pool) {
                this.pool.end();
                this.pool = null;
            }
            this.active = false;
        };

        Database.prototype.create_table = function (trellis) {
            if (!trellis)
                throw new Error('Empty object was passed to create_table().');

            var table = Ground.Table.create_from_trellis(trellis);
            var sql = table.create_sql_from_trellis(trellis);
            return this.query(sql).then(function () {
                return table;
            });
        };

        Database.prototype.create_trellis_tables = function (trellises) {
            var _this = this;
            var promises = MetaHub.map_to_array(trellises, function (trellis) {
                return _this.create_table(trellis);
            });
            return when.all(promises);
        };

        Database.prototype.drop_all_tables = function () {
            var _this = this;
            return when.map(this.get_tables(), function (table) {
                return _this.query('DROP TABLE IF EXISTS `' + table + '`');
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
            var def = when.defer();

            if (this.log_queries)
                console.log('start', sql);

            this.pool.query(sql, args, function (err, rows, fields) {
                if (err) {
                    console.log('error', sql);
                    throw err;
                }

                def.resolve(rows, fields);

                return null;
            });

            return def.promise;
        };

        Database.prototype.query_single = function (sql, args) {
            if (typeof args === "undefined") { args = undefined; }
            return this.query(sql, args).then(function (rows) {
                return rows[0];
            });
        };
        return Database;
    })();
    Ground.Database = Database;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Trellis = (function () {
        function Trellis(name, ground) {
            this.parent = null;
            this.table = null;
            this.name = null;
            this.primary_key = 'id';
            this.is_virtual = false;
            this.properties = {};
            this.all_properties = {};
            this.ground = ground;
            this.name = name;
        }
        Trellis.prototype.add_property = function (name, source) {
            var property = new Ground.Property(name, source, this);
            this.properties[name] = property;
            this.all_properties[name] = property;
            if (property.insert == 'trellis' && !this.type_property)
                this.type_property = property;

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

        Trellis.prototype.get_property = function (name) {
            var properties = this.get_all_properties();
            var property = properties[name];
            if (!property)
                throw new Error('Trellis ' + this.name + ' does not contain a property named ' + name + '.');

            return property;
        };

        Trellis.prototype.get_core_properties = function () {
            var result = {};
            for (var i in this.properties) {
                var property = this.properties[i];
                if (property.type != 'list')
                    result[i] = property;
            }

            return result;
        };

        Trellis.prototype.get_id = function (source) {
            if (source && typeof source === 'object')
                return source[this.primary_key];

            return source;
        };

        Trellis.prototype.get_identity = function (seed) {
            var composite = this.properties[this.primary_key].get_composite().filter(function (x) {
                return seed[x.name] !== undefined;
            });

            var result = {};
            for (var i in composite) {
                var c = composite[i];
                result[c.name] = seed[c.name];
            }

            return result;
        };

        Trellis.prototype.get_identity2 = function (value) {
            if (typeof value == 'object')
                return value[this.primary_key];

            return value;
        };

        Trellis.prototype.get_ancestor_join = function (other) {
            var conditions = this.get_primary_keys().map(function (property) {
                return property.query() + ' = ' + other.properties[property.name].query();
            });

            return 'JOIN  ' + other.get_table_query() + ' ON ' + conditions.join(' AND ');
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

        Trellis.prototype.get_primary_keys = function () {
            if (this.table && this.table.primary_keys) {
                var result = [];
                for (var i in this.table.primary_keys) {
                    var key = this.table.primary_keys[i];
                    result.push(this.properties[key]);
                }
                return result;
            }

            return [this.properties[this.primary_key]];
        };

        Trellis.prototype.get_primary_property = function () {
            return this.properties[this.primary_key];
        };

        Trellis.prototype.get_reference_property = function (other_trellis) {
            var properties = this.get_all_properties();
            for (var i in properties) {
                var property = properties[i];
                if (property.other_trellis === other_trellis)
                    return property;
            }

            return null;
        };

        Trellis.prototype.get_root_table = function () {
            if (this.parent && this.ground.tables[this.parent.name])
                return this.parent.get_root_table();

            return this.ground.tables[this.name];
        };

        Trellis.prototype.get_table_name = function () {
            if (this.is_virtual) {
                if (this.parent) {
                    return this.parent.get_table_name();
                }
            }
            if (this.table) {
                if (this.table.db_name)
                    return this.table.db_name + '.' + this.table.name;
                else
                    return this.table.name;
            }

            return this.name + 's';
        };

        Trellis.prototype.get_table_query = function () {
            if (this.table && this.table.query)
                return this.table.query;

            return '`' + this.get_table_name() + '`';
        };

        Trellis.prototype.get_tree = function () {
            var trellis = this;
            var tree = [];

            do {
                tree.unshift(trellis);
            } while(trellis = trellis.parent);

            return tree;
        };

        Trellis.prototype.initialize = function (all) {
            if (typeof this.parent === 'string') {
                if (!all[this.parent])
                    throw new Error(this.name + ' references a parent that does not exist: ' + this.parent + '.');

                this.set_parent(all[this.parent]);
                this.check_primary_key();
            }

            for (var j in this.properties) {
                var property = this.properties[j];
                if (property.other_trellis_name) {
                    var other_trellis = property.other_trellis = all[property.other_trellis_name];
                    if (!other_trellis)
                        throw new Error('Cannot find referenced trellis for ' + this.name + '.' + property.name + ': ' + property.other_trellis_name + '.');

                    property.initialize_composite_reference(other_trellis);
                }
            }
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

        Trellis.prototype.query = function () {
            return this.get_table_query() + '.' + this.properties[this.primary_key].get_field_name();
        };

        Trellis.prototype.query_primary_key = function () {
            return this.query();
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

            var keys;

            if (parent.table && parent.table.primary_keys) {
                keys = parent.table.primary_keys;
                if (!this.table)
                    this.table = Ground.Table.create_from_trellis(this);

                this.table.primary_keys = keys;
            } else {
                keys = [parent.primary_key];
            }

            for (var i = 0; i < keys.length; ++i) {
                parent.clone_property(keys[i], this);
            }
            this.primary_key = parent.primary_key;
        };

        Trellis.prototype.seed_has_properties = function (seed, properties) {
            for (var i in properties) {
                var name = properties[i];
                if (seed[name] === undefined)
                    return false;
            }

            return true;
        };

        Trellis.prototype.assure_properties = function (seed, required_properties) {
            if (this.seed_has_properties(seed, required_properties)) {
                return when.resolve(seed);
            }

            var query = this.ground.create_query(this.name);
            query.add_key_filter(this.get_identity2(seed));
            query.extend({
                properties: required_properties
            });
            return query.run_single();
        };

        Trellis.prototype.export_schema = function () {
            var result = {};
            if (this.parent)
                result.parent = this.parent.name;
            else if (this.primary_key != 'id')
                result.primary_key = this.primary_key;

            if (this.is_virtual)
                result.is_virtual = true;

            result.properties = MetaHub.map(this.properties, function (property) {
                return property.export_schema();
            });

            return result;
        };
        return Trellis;
    })();
    Ground.Trellis = Trellis;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Query = (function () {
        function Query(trellis, base_path) {
            if (typeof base_path === "undefined") { base_path = null; }
            this.joins = [];
            this.post_clauses = [];
            this.include_links = true;
            this.fields = [];
            this.arguments = {};
            this.expansions = [];
            this.wrappers = [];
            this.type = 'query';
            this.sorts = [];
            this.filters = [];
            this.property_filters = [];
            this.links = [];
            this.trellis = trellis;
            this.ground = trellis.ground;
            this.db = this.ground.db;
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

        Query.prototype.add_property_filter = function (property, value, operator) {
            if (typeof value === "undefined") { value = null; }
            if (typeof operator === "undefined") { operator = '='; }
            if (Query.operators.indexOf(operator) === -1)
                throw new Error("Invalid operator: '" + operator + "'.");

            if (value === null || value === undefined)
                throw new Error('Cannot add property filter where value is null; property= ' + this.trellis.name + '.' + property + '.');

            this.property_filters.push({
                property: property,
                value: value,
                operator: operator
            });
        };

        Query.prototype.add_key_filter = function (value) {
            this.add_property_filter(this.trellis.primary_key, value);
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

        Query.prototype.add_sort = function (sort) {
            for (var i = 0; i < this.sorts.length; ++i) {
                if (this.sorts[i].property == sort.property) {
                    this.sorts.splice(i, 1);
                    break;
                }
            }

            this.sorts.push(sort);
        };

        Query.process_sorts = function (sorts, trellis) {
            if (sorts.length == 0)
                return '';

            if (trellis)
                var properties = trellis.get_all_properties();

            var items = sorts.map(function (sort) {
                var sql;
                if (trellis) {
                    if (!properties[sort.property])
                        throw new Error(trellis.name + ' does not contain sort property: ' + sort.property);

                    sql = properties[sort.property].query();
                } else {
                    sql = sort.property;
                }

                if (typeof sort.dir === 'string') {
                    var dir = sort.dir.toUpperCase();
                    if (dir == 'ASC')
                        sql += ' ASC';
                    else if (dir == 'DESC')
                        sql += ' DESC';
                }

                return 'ORDER BY ' + sql;
            });

            return items.join(', ');
        };

        Query.prototype.add_wrapper = function (wrapper) {
            this.wrappers.push(wrapper);
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
            var filters;
            var data = this.get_fields_and_joins(properties);
            var data2 = this.process_property_filters();
            var fields = data.fields.concat(this.fields);
            var joins = data.joins.concat(this.joins, data2.joins);
            var args = MetaHub.concat(this.arguments, data2.arguments);
            if (data2.filters)
                filters = this.filters.concat(data2.filters);
            else
                filters = this.filters;

            if (fields.length == 0)
                throw new Error('No authorized fields found for trellis ' + this.trellis.name + '.');

            var sql = 'SELECT ';
            sql += fields.join(",\n");
            sql += "\nFROM `" + this.trellis.get_table_name() + '`';
            if (joins.length > 0)
                sql += "\n" + joins.join("\n");

            if (filters.length > 0)
                sql += "\nWHERE " + filters.join(" AND ");

            if (this.sorts.length > 0)
                sql += ' ' + Query.process_sorts(this.sorts, this.trellis);

            if (this.post_clauses.length > 0)
                sql += " " + this.post_clauses.join(" ");

            for (var i = 0; i < this.wrappers.length; ++i) {
                var wrapper = this.wrappers[i];
                sql = wrapper.start + sql + wrapper.end;
            }

            for (var pattern in args) {
                var value = args[pattern];

                sql = sql.replace(new RegExp(pattern), value);
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
                    var sql = property.get_field_query();
                    fields.push(sql);
                    if (property.parent.name != this.trellis.name)
                        trellises[property.parent.name] = property.parent;
                }
            }
            var joins = [];
            for (name in trellises) {
                var trellis = trellises[name];
                var join = this.trellis.get_ancestor_join(trellis);
                if (join)
                    joins.push(join);
            }

            return {
                fields: fields,
                joins: joins
            };
        };

        Query.prototype.get_primary_key_value = function () {
            var _this = this;
            var filters = this.property_filters.filter(function (filter) {
                return filter.property == _this.trellis.primary_key;
            });
            if (filters.length > 0)
                return filters[0].value;

            return undefined;
        };

        Query.generate_property_join = function (property, seeds) {
            var join = Ground.Link_Trellis.create_from_property(property);
            return join.generate_join(seeds);
        };

        Query.prototype.create_sub_query = function (trellis, property) {
            var query = new Query(trellis, this.get_path(property.name));
            query.include_links = false;
            query.expansions = this.expansions;
            if (typeof this.properties === 'object' && typeof this.properties[property.name] === 'object') {
                query.extend(this.properties[property.name]);
            }

            return query;
        };

        Query.prototype.get_many_list = function (seed, property, relationship) {
            var id = seed[property.parent.primary_key];
            if (id === undefined || id === null)
                throw new Error('Cannot get many-to-many list when seed id is null.');

            var other_property = property.get_other_property();
            if (!other_property)
                return when.resolve();

            var query = this.create_sub_query(other_property.parent, property);
            if (relationship === 3 /* many_to_many */) {
                var seeds = {};
                seeds[this.trellis.name] = seed;
                query.add_join(Query.generate_property_join(property, seeds));
            } else if (relationship === 2 /* one_to_many */)
                query.add_property_filter(other_property.name, id);

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
            var query = this.create_sub_query(property.other_trellis, property);
            var value = row[property.name];
            if (!value)
                return when.resolve(value);

            query.add_key_filter(value);
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

        Query.prototype.process_row = function (row) {
            var _this = this;
            var name, property;

            var properties = this.trellis.get_core_properties();
            for (name in properties) {
                property = properties[name];
                var value = row[property.name];
                if (value === undefined)
                    continue;

                row[property.name] = this.ground.convert_value(value, property.type);
            }

            var links = this.trellis.get_all_links(function (p) {
                return !p.is_virtual;
            });

            var promises = MetaHub.map_to_array(links, function (property, name) {
                if (property.is_composite_sub)
                    return null;

                var path = _this.get_path(property.name);

                if (_this.include_links || _this.has_expansion(path)) {
                    return _this.query_link_property(row, property).then(function (value) {
                        row[name] = value;
                        return row;
                    });
                }

                return null;
            });

            return when.all(promises).then(function () {
                return _this.ground.invoke(_this.trellis.name + '.queried', row, _this);
            }).then(function () {
                return row;
            });
        };

        Query.prototype.query_link_property = function (seed, property) {
            var relationship = property.get_relationship();

            switch (relationship) {
                case 1 /* one_to_one */:
                    return this.get_reference_object(seed, property);
                    break;
                case 2 /* one_to_many */:
                case 3 /* many_to_many */:
                    return this.get_many_list(seed, property, relationship);
                    break;
            }

            throw new Error('Could not find relationship: ' + relationship + '.');
        };

        Query.prototype.process_property_filter = function (filter) {
            var result = {
                filters: [],
                arguments: {},
                joins: []
            };
            var property = this.trellis.sanitize_property(filter.property);
            var value = filter.value;

            var placeholder = ':' + property.name + '_filter';

            if (value !== null)
                value = this.ground.convert_value(value, property.type);

            if (value === null || value === undefined) {
                throw new Error('Query property filter ' + placeholder + ' is null.');
            }

            if (property.get_relationship() == 3 /* many_to_many */) {
                var join_seed = {};
                join_seed[property.other_trellis.name] = ':' + property.name + '_filter';

                result.joins.push(Query.generate_property_join(property, join_seed));
            } else {
                if (filter.operator.toLowerCase() == 'like') {
                    result.filters.push(property.query() + ' LIKE ' + placeholder);
                    if (value !== null)
                        value = '%' + value + '%';
                } else {
                    result.filters.push(property.query() + ' = ' + placeholder);
                }
            }

            if (value !== null) {
                value = property.get_sql_value(value);
                result.arguments[placeholder] = value;
            }

            return result;
        };

        Query.prototype.process_property_filters = function () {
            var result = {};
            for (var i in this.property_filters) {
                var filter = this.property_filters[i];
                MetaHub.extend(result, this.process_property_filter(filter));
            }
            return result;
        };

        Query.prototype.extend = function (source) {
            var i;

            this.source = source;

            if (source.filters) {
                for (i = 0; i < source.filters.length; ++i) {
                    var filter = source.filters[i];
                    this.add_property_filter(filter.path || filter.property, filter.value, filter.operator);
                }
            }

            if (source.sorts) {
                for (i = 0; i < source.sorts.length; ++i) {
                    this.add_sort(source.sorts[i]);
                }
            }

            if (source.properties) {
                var properties = this.trellis.get_all_properties();
                this.properties = {};
                for (var i in source.properties) {
                    var property = source.properties[i];
                    if (typeof property == 'string') {
                        if (!properties[property])
                            throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + property + '.');

                        this.properties[property] = {};
                    } else {
                        if (!properties[property.name])
                            throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + property.name + '.');

                        if (property)
                            this.properties[property.name] = property;
                    }
                }

                var identities = [this.trellis.properties[this.trellis.primary_key]];
                if (identities[0].composite_properties && identities[0].composite_properties.length > 0) {
                    identities = identities.concat(identities[0].composite_properties);
                }

                for (var k in identities) {
                    var identity = identities[k];
                    if (!this.properties[identity.name])
                        this.properties[identity.name] = {};
                }
            }
        };

        Query.prototype.run_core = function () {
            var _this = this;
            if (this.row_cache)
                return when.resolve(this.row_cache);

            var properties;
            if (this.properties && Object.keys(this.properties).length > 0) {
                properties = this.trellis.get_all_properties();
                properties = MetaHub.map(this.properties, function (property, key) {
                    return properties[key];
                });
            } else {
                properties = this.trellis.get_all_properties();
            }

            var tree = this.trellis.get_tree();
            var promises = tree.map(function (trellis) {
                return _this.ground.invoke(trellis.name + '.query', _this);
            });

            return when.all(promises).then(function () {
                var sql = _this.generate_sql(properties);
                sql = sql.replace(/\r/g, "\n");
                if (_this.ground.log_queries)
                    console.log('query', sql);

                return _this.db.query(sql).then(function (rows) {
                    _this.row_cache = rows;
                    return rows;
                });
            });
        };

        Query.prototype.run = function () {
            var _this = this;
            if (this.ground.log_queries) {
                var temp = new Error();
                this.run_stack = temp['stack'];
            }

            var properties = this.trellis.get_all_properties();
            return this.run_core().then(function (rows) {
                return when.all(rows.map(function (row) {
                    return _this.process_row(row);
                }));
            });
        };

        Query.get_identity_sql = function (property, cross_property) {
            if (typeof cross_property === "undefined") { cross_property = null; }
            if (cross_property) {
                var join = Ground.Link_Trellis.create_from_property(cross_property);
                var identity = join.get_identity_by_trellis(cross_property.other_trellis);
                return join.table_name + '.' + identity.name;
            } else if (property.type == 'list') {
                var trellis = property.parent;

                return trellis.query_primary_key();
            } else {
                return property.query();
            }
        };

        Query.generate_join = function (property, cross_property) {
            if (typeof cross_property === "undefined") { cross_property = null; }
            var other_property = property.get_other_property(true);

            var other = property.other_trellis;

            var relationship = property.get_relationship();

            switch (relationship) {
                case 1 /* one_to_one */:
                case 2 /* one_to_many */:
                    var first_part, second_part;
                    if (property.type == 'list')
                        first_part = other_property.query();
                    else
                        first_part = other.query_primary_key();

                    second_part = Query.get_identity_sql(property, cross_property);

                    return 'JOIN ' + other.get_table_query() + '\nON ' + first_part + ' = ' + second_part + '\n';

                case 3 /* many_to_many */:
                    var seeds = {};

                    var join = Ground.Link_Trellis.create_from_property(property);
                    var identity = join.get_identity_by_trellis(property.parent);
                    return 'JOIN ' + join.table_name + '\nON ' + join.get_identity_conditions(identity, {}, true).join(' AND ') + '\n';
            }
        };

        Query.query_path = function (path, args, ground) {
            var sql = Query.follow_path(path, args, ground);

            return ground.db.query_single(sql);
        };

        Query.follow_path = function (path, args, ground) {
            var parts = Ground.path_to_array(path);
            var sql = 'SELECT COUNT(*) AS total\n';

            var cross_property = null, first_trellis;

            var trellis = first_trellis = ground.sanitize_trellis_argument(parts[0]);
            sql += 'FROM `' + trellis.get_table_name() + '`\n';

            for (var i = 1; i < parts.length; ++i) {
                var properties = trellis.get_all_properties();
                var property = properties[parts[i]];
                if (!property)
                    throw new Error('Could not find ' + trellis.name + '.' + parts[i] + '.');

                sql += Query.generate_join(property, cross_property);
                cross_property = property.get_relationship() == 3 /* many_to_many */ ? property : null;
                trellis = property.other_trellis;
            }

            if (args[1]) {
                sql += ' AND ' + Query.get_identity_sql(property, cross_property) + ' = ' + trellis.properties[trellis.primary_key].get_sql_value(args[1]) + '\n';
            }

            sql += 'WHERE ' + first_trellis.query_primary_key() + ' = ' + first_trellis.properties[first_trellis.primary_key].get_sql_value(args[0]) + '\n';

            return sql;
        };

        Query.process_tokens = function (tokens, args, ground) {
            var result = [];
            var trellis;
            for (var i = 0; i < tokens.length; ++i) {
                var token = tokens[i];
                if (token[0] == ':') {
                    var arg = args[token];
                    trellis = arg.trellis;
                }
            }

            return result;
        };
        Query.operators = [
            '=',
            'LIKE',
            '!='
        ];
        return Query;
    })();
    Ground.Query = Query;
})(Ground || (Ground = {}));
var uuid = require('node-uuid');

var Ground;
(function (Ground) {
    var Update = (function () {
        function Update(trellis, seed, ground) {
            if (typeof ground === "undefined") { ground = null; }
            this.override = true;
            this.main_table = 'node';
            this.log_queries = false;
            if (typeof seed !== 'object')
                throw new Error('Seed passed to ' + trellis.name + ' is a ' + (typeof seed) + ' when it should be an object.');

            if (!seed)
                throw new Error('Seed passed to ' + trellis.name + ' is null');

            this.seed = seed;
            this.trellis = trellis;
            this.main_table = this.trellis.get_table_name();
            this.ground = ground || this.trellis.ground;
            this.db = ground.db;
        }
        Update.prototype.get_access_name = function () {
            return this.trellis + '.update';
        };

        Update.prototype.generate_sql = function (trellis) {
            var _this = this;
            var duplicate = '', primary_keys;
            var id = this.seed[trellis.primary_key];
            if (!id && id !== 0) {
                return this.create_record(trellis);
            } else {
                var table = trellis.get_root_table();
                if (table && table.primary_keys && table.primary_keys.length > 0)
                    primary_keys = table.primary_keys;
                else
                    primary_keys = [trellis.primary_key];

                var conditions = [];
                var ids = [];
                for (var i in primary_keys) {
                    var key = primary_keys[i];
                    ids[key] = this.seed[key];

                    var value = trellis.properties[key].get_sql_value(ids[key]);
                    conditions.push(key + ' = ' + value);
                }

                var condition_string = conditions.join(' AND ');
                if (!condition_string)
                    throw new Error('Conditions string cannot be empty.');

                var sql = 'SELECT ' + primary_keys.join(', ') + ' FROM `' + trellis.get_table_name() + '` WHERE ' + condition_string;

                return this.db.query_single(sql).then(function (id_result) {
                    if (!id_result)
                        return _this.create_record(trellis);
                    else
                        return _this.update_record(trellis, id, condition_string);
                });
            }
        };

        Update.prototype.update_embedded_seed = function (property, value) {
            var _this = this;
            var type_property = property.parent.type_property;

            var type = type_property ? value[type_property.name] : null;

            var other_trellis = value.trellis || type || property.other_trellis;
            return this.ground.update_object(other_trellis, value, this.user).then(function (entity) {
                _this.seed[property.name] = entity;
            });
        };

        Update.prototype.update_embedded_seeds = function (core_properties) {
            var promises = [];
            for (var name in core_properties) {
                var property = core_properties[name];
                var value = this.seed[property.name];
                if (property.type == 'reference' && value && typeof value === 'object') {
                    promises.push(this.update_embedded_seed(property, value));
                }
            }

            return when.all(promises);
        };

        Update.prototype.create_record = function (trellis) {
            var _this = this;
            var fields = [];
            var values = [];
            var core_properties = trellis.get_core_properties();

            if (core_properties[trellis.primary_key].type == 'guid' && !this.seed[trellis.primary_key]) {
                this.seed[trellis.primary_key] = uuid.v1();
            }

            return this.update_embedded_seeds(core_properties).then(function () {
                var add_fields = function (properties, seed) {
                    for (var name in properties) {
                        var property = properties[name];
                        var seed_name = property.get_seed_name();
                        if (seed[seed_name] === undefined && !_this.is_create_property(property))
                            continue;

                        var value = _this.get_field_value(property, seed);
                        fields.push('`' + property.get_field_name() + '`');
                        values.push(value);

                        var composite_properties = property.composite_properties;
                        var composite_seed = seed[seed_name];
                        if (composite_properties && composite_properties.length > 0 && typeof composite_seed === 'object') {
                            add_fields(composite_properties, composite_seed);
                        }
                    }
                };

                add_fields(core_properties, _this.seed);

                var field_string = fields.join(', ');
                var value_string = values.join(', ');
                var sql = 'INSERT INTO `' + trellis.get_table_name() + '` (' + field_string + ') VALUES (' + value_string + ");\n";
                if (_this.log_queries)
                    console.log(sql);

                return _this.db.query(sql).then(function (result) {
                    var id;
                    if (_this.seed[trellis.primary_key]) {
                        id = _this.seed[trellis.primary_key];
                    } else {
                        id = result.insertId;
                        _this.seed[trellis.primary_key] = id;
                    }

                    return _this.update_links(trellis, id, true).then(function () {
                        return _this.ground.invoke(trellis.name + '.created', _this.seed, _this);
                    });
                });
            });
        };

        Update.prototype.update_record = function (trellis, id, key_condition) {
            var _this = this;
            var core_properties = MetaHub.filter(trellis.get_core_properties(), function (p) {
                return _this.is_update_property(p);
            });

            return this.update_embedded_seeds(core_properties).then(function () {
                var next = function () {
                    return _this.update_links(trellis, id).then(function () {
                        return _this.ground.invoke(trellis.name + '.updated', _this.seed, _this);
                    });
                };

                var updates = [];

                for (var name in core_properties) {
                    var property = core_properties[name];
                    if (_this.seed[property.name] === undefined) {
                        if (property.insert == 'trellis') {
                            _this.seed[property.name] = _this.trellis.name;
                        } else
                            continue;
                    }
                    var field_string = '`' + property.get_field_name() + '`';
                    var value = _this.get_field_value(property, _this.seed);
                    updates.push(field_string + ' = ' + value);
                }

                if (updates.length === 0)
                    return next();

                var sql = 'UPDATE `' + trellis.get_table_name() + "`\n" + 'SET ' + updates.join(', ') + "\n" + 'WHERE ' + key_condition + "\n;";

                if (_this.log_queries)
                    console.log(sql);

                return _this.db.query(sql).then(next);
            });
        };

        Update.prototype.apply_insert = function (property, value) {
            if (property.insert == 'trellis')
                return this.trellis.name;

            if (property.type == 'created' || property.type == 'modified')
                return Math.round(new Date().getTime() / 1000);

            if (!value && property.insert == 'author') {
                if (!this.user) {
                    throw new Error('Cannot insert author into ' + property.parent.name + '.' + property.name + ' because current user is not set.');
                }
                return this.user.id;
            }

            return value;
        };

        Update.prototype.is_create_property = function (property) {
            if (property.is_virtual)
                return false;

            var field = property.get_field_override();
            if (field && field.share)
                return false;

            return property.insert == 'trellis' || property.type == 'created' || property.type == 'modified' || property.insert == 'author';
        };

        Update.prototype.get_field_value = function (property, seed) {
            var name = property.get_seed_name();
            var value = seed[name];
            value = this.apply_insert(property, value);
            seed[name] = value;

            return property.get_sql_value(value);
        };

        Update.prototype.is_update_property = function (property) {
            if (property.is_virtual)
                return false;

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
                if (!create) {
                    if (property.is_readonly || property.is_private)
                        continue;
                }

                switch (property.get_relationship()) {
                    case 2 /* one_to_many */:
                        promises.push(this.update_one_to_many(property));
                        break;
                    case 3 /* many_to_many */:
                        promises.push(this.update_many_to_many(property, create));
                        break;
                }
            }

            return when.all(promises);
        };

        Update.prototype.update_many_to_many = function (property, create) {
            if (typeof create === "undefined") { create = false; }
            var _this = this;
            var list = this.seed[property.name];
            var row = this.seed;
            if (!MetaHub.is_array(list))
                return when.resolve();

            var join = Ground.Link_Trellis.create_from_property(property);
            var other_trellis = property.get_referenced_trellis();

            var update = function (other) {
                var sql, other_id = other_trellis.get_id(other);

                return _this.update_reference_object(other, property).then(function () {
                    if (typeof other === 'object' && other._removed_) {
                        if (other_id !== null) {
                            var cross = new Ground.Cross_Trellis(property);
                            cross['alias'] = null;

                            sql = cross.generate_delete(property, row, other);
                            if (_this.ground.log_updates)
                                console.log(sql);

                            return _this.ground.invoke(join.table_name + '.remove', row, property, other, join).then(function () {
                                return _this.db.query(sql);
                            }).then(function () {
                                return _this.ground.invoke(join.table_name + '.removed', row, property, other, join);
                            });
                        }
                    } else {
                        if (other_id === null) {
                            other = _this.ground.update_object(other_trellis, other, _this.user).then(function (other) {
                                var cross = new Ground.Cross_Trellis(property);
                                sql = cross.generate_insert(property, row, other);
                                if (_this.ground.log_updates)
                                    console.log(sql);

                                return _this.ground.invoke(join.table_name + '.create', row, property, other, join).then(function () {
                                    return _this.db.query(sql);
                                }).then(function () {
                                    return _this.ground.invoke(join.table_name + '.created', row, property, other, join);
                                });
                            });
                        } else {
                            var cross = new Ground.Cross_Trellis(property);
                            sql = cross.generate_insert(property, row, other);
                            if (_this.ground.log_updates)
                                console.log(sql);

                            return _this.ground.invoke(join.table_name + '.create', row, property, other, join).then(function () {
                                return _this.db.query(sql);
                            }).then(function () {
                                return _this.ground.invoke(join.table_name + '.created', row, property, other, join);
                            });
                        }
                    }
                });
            };

            return when.all(list.map(update));
        };

        Update.prototype.update_one_to_many = function (property) {
            var _this = this;
            var seed = this.seed;
            var list = seed[property.name];
            if (!MetaHub.is_array(list))
                return when.resolve();

            var promises = MetaHub.map_to_array(list, function (item) {
                return _this.update_reference_object(item, property);
            });

            return when.all(promises);
        };

        Update.prototype.update_reference = function (property, id) {
            var item = this.seed[property.name];
            if (!item)
                return when.resolve();

            return this.update_reference_object(item, property);
        };

        Update.prototype.update_reference_object = function (other, property) {
            if (typeof other !== 'object') {
                property.get_sql_value(other);
                return when.resolve();
            }

            var trellis;
            if (other.trellis)
                trellis = other.trellis;
            else
                trellis = property.other_trellis;

            var other_property = property.get_other_property();
            if (other_property) {
                other[other_property.name] = this.seed[this.trellis.primary_key];
                if (other_property.composite_properties) {
                    for (var i = 0; i < other_property.composite_properties.length; ++i) {
                        var secondary = other_property.composite_properties[i];
                        other[secondary.name] = this.seed[secondary.get_other_property(true).name];
                    }
                }
            }

            return this.ground.update_object(trellis, other, this.user);
        };

        Update.prototype.run = function () {
            var _this = this;
            var pipeline = require('when/pipeline');

            if (this.log_queries) {
                var temp = new Error();
                this.run_stack = temp['stack'];
            }

            var tree = this.trellis.get_tree().filter(function (t) {
                return !t.is_virtual;
            });
            var invoke_promises = tree.map(function (trellis) {
                return function () {
                    return _this.ground.invoke(trellis.name + '.update', _this.seed, _this);
                };
            });

            invoke_promises = invoke_promises.concat(function () {
                return _this.ground.invoke('*.update', _this.seed, _this);
            });

            return pipeline(invoke_promises).then(function () {
                var promises = tree.map(function (trellis) {
                    return function () {
                        return _this.generate_sql(trellis);
                    };
                });
                return pipeline(promises).then(function () {
                    return _this.seed;
                });
            });
        };
        return Update;
    })();
    Ground.Update = Update;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Delete = (function () {
        function Delete(ground, trellis, seed) {
            this.max_depth = 20;
            this.ground = ground;
            this.trellis = trellis;
            this.seed = seed;
        }
        Delete.prototype.get_access_name = function () {
            return this.trellis + '.delete';
        };

        Delete.prototype.delete_child = function (link, id, depth) {
            if (typeof depth === "undefined") { depth = 0; }
            var _this = this;
            var other_property = link.get_other_property();
            var other_trellis = other_property.parent;
            var query = other_trellis.ground.create_query(other_trellis.name);
            query.add_key_filter(id);
            return query.run().then(function (objects) {
                return when.all(objects.map(function (object) {
                    return _this.run_delete(other_trellis, object, depth + 1);
                }));
            });
        };

        Delete.prototype.delete_children = function (trellis, id, depth) {
            if (typeof depth === "undefined") { depth = 0; }
            var _this = this;
            var links = this.get_child_links(trellis);
            return when.all(links.map(function (link) {
                return _this.delete_child(link, id, depth);
            }));
        };

        Delete.prototype.delete_record = function (trellis, id) {
            var sql = 'DELETE FROM ' + trellis.get_table_name() + "\nWHERE " + trellis.query_primary_key() + ' = ' + id;

            if (this.ground.log_updates)
                console.log(sql);

            return this.ground.db.query(sql);
        };

        Delete.prototype.get_child_links = function (trellis) {
            var result = [], links = trellis.get_links();
            for (var i in links) {
                var link = links[i];
                var other = link.get_other_property();

                if (other && (other.name == 'parent' || other.is_parent))
                    result.push(link);
            }

            return result;
        };

        Delete.prototype.run = function (depth) {
            if (typeof depth === "undefined") { depth = 0; }
            var trellis = this.trellis;
            var seed = this.seed;
            return this.run_delete(trellis, seed, depth);
        };

        Delete.prototype.run_delete = function (trellis, seed, depth) {
            if (typeof depth === "undefined") { depth = 0; }
            var _this = this;
            if (depth > this.max_depth)
                throw new Error("Max depth of " + this.max_depth + " exceeded.  Possible infinite loop.");
            console.log('deleting');
            var id = seed[trellis.primary_key];
            if (id === null || id === undefined)
                throw new Error("Object was tagged to be deleted but has no identity.");

            id = trellis.properties[trellis.primary_key].get_sql_value(id);
            var property_names = MetaHub.map_to_array(trellis.get_all_properties(), function (x) {
                return x.name;
            });

            return trellis.assure_properties(seed, property_names).then(function (seed) {
                var tree = trellis.get_tree().filter(function (t) {
                    return !t.is_virtual;
                });
                var invoke_promises = tree.map(function (trellis) {
                    return _this.ground.invoke(trellis.name + '.delete', seed);
                });

                return when.all(invoke_promises).then(function () {
                    return when.all(tree.map(function (trellis) {
                        return _this.delete_record(trellis, id);
                    }));
                }).then(function () {
                    return when.all(tree.map(function (trellis) {
                        return _this.ground.invoke(trellis.name + '.deleted', seed);
                    }));
                }).then(function () {
                    return _this.delete_children(trellis, id, depth);
                });
            });
        };
        return Delete;
    })();
    Ground.Delete = Delete;
})(Ground || (Ground = {}));
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var Ground;
(function (Ground) {
    function path_to_array(path) {
        if (MetaHub.is_array(path))
            return path;

        path = path.trim();

        if (!path)
            throw new Error('Empty query path.');

        return path.split(/[\/\.]/);
    }
    Ground.path_to_array = path_to_array;

    var Property_Type = (function () {
        function Property_Type(name, info, types) {
            this.allow_null = false;
            if (info.parent) {
                var parent = types[info.parent];
                MetaHub.extend(this, parent);
                this.parent = parent;
            } else {
                this.field_type = info.field_type;
            }

            this.name = name;
            this.property_class = 'Property';
            if (info.default !== undefined)
                this.default_value = info.default;

            if (info.allow_null !== undefined)
                this.allow_null = info.allow_null;
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
            this.custom_tables = [];
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
            if (value === undefined || value === null || value === false) {
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
                case 'number':
                case 'int':
                    return Math.round(value);
                case 'string':
                case 'text':
                    return value;
                case 'boolean':
                case 'bool':
                    return Core.to_bool(value);
                case 'float':
                case 'double':
                case 'money':
                    return parseFloat(value.toString());
            }

            throw new Error('Not sure how to convert sql type of ' + type + '.');
        };

        Core.prototype.create_remaining_tables = function () {
            for (var i in this.trellises) {
                var trellis = this.trellises[i];
                if (this.tables[trellis.name])
                    continue;

                var table = Ground.Table.create_from_trellis(trellis, this);
                this.tables[i] = table;
            }
        };

        Core.prototype.create_missing_table_links = function () {
            for (var i in this.trellises) {
                var trellis = this.trellises[i];
                var table = this.tables[trellis.name];
                var links = trellis.get_all_links();
                for (var p in links) {
                    if (!table.links[p])
                        table.create_link(links[p]);
                }
            }
        };

        Core.prototype.create_query = function (trellis_name, base_path) {
            if (typeof base_path === "undefined") { base_path = ''; }
            var trellis = this.sanitize_trellis_argument(trellis_name);

            return new Ground.Query_Builder(trellis);
        };

        Core.prototype.create_update = function (trellis, seed, user) {
            if (typeof seed === "undefined") { seed = {}; }
            if (typeof user === "undefined") { user = null; }
            trellis = this.sanitize_trellis_argument(trellis);

            if (seed._deleted === true || seed._deleted === 'true' || seed._deleted_ === true || seed._deleted_ === 'true')
                return new Ground.Delete(this, trellis, seed);

            var update = new Ground.Update(trellis, seed, this);
            update.user = user;
            update.log_queries = this.log_updates;
            return update;
        };

        Core.prototype.delete_object = function (trellis, seed) {
            var trellis = this.sanitize_trellis_argument(trellis);
            var del = new Ground.Delete(this, trellis, seed);
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

            if (seed._deleted === true || seed._deleted === 'true' || seed._deleted_ === true || seed._deleted_ === 'true')
                return this.delete_object(trellis, seed);

            var update = new Ground.Update(trellis, seed, this);
            update.user = user;
            update.log_queries = this.log_updates;

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
                this.custom_tables[name] = table;
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

            if (MetaHub.is_array(data.logic) && data.logic.length > 0) {
                Ground.Logic.load(this, data.logic);
            }

            this.create_remaining_tables();
            this.create_missing_table_links();
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

        Core.prototype.stop = function () {
            console.log('Closing database connections.');
            this.db.close();
            console.log('Finished closing database.');
        };

        Core.to_bool = function (input) {
            if (typeof input == 'string') {
                return input.toLowerCase() == 'true';
            }

            return !!input;
        };

        Core.prototype.export_schema = function () {
            return {
                trellises: MetaHub.map(this.trellises, function (trellis) {
                    return trellis.export_schema();
                })
            };
        };
        return Core;
    })(MetaHub.Meta_Object);
    Ground.Core = Core;
})(Ground || (Ground = {}));

module.exports = Ground;
var Ground;
(function (Ground) {
    (function (Link_Field_Type) {
        Link_Field_Type[Link_Field_Type["identity"] = 0] = "identity";
        Link_Field_Type[Link_Field_Type["reference"] = 1] = "reference";
    })(Ground.Link_Field_Type || (Ground.Link_Field_Type = {}));
    var Link_Field_Type = Ground.Link_Field_Type;

    var Link_Field = (function () {
        function Link_Field(name, parent, other_table, type) {
            this.name = name;
            this.parent = parent;
            this.other_table = other_table;
            this.type = type;
        }
        return Link_Field;
    })();
    Ground.Link_Field = Link_Field;

    var Table = (function () {
        function Table(name, ground) {
            this.properties = {};
            this.links = {};
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

        Table.get_other_table = function (property) {
            var ground = property.parent.ground;
            var name = Table.get_other_table_name(property);
            return ground.tables[name];
        };

        Table.get_other_table_name = function (property) {
            var field = property.get_field_override();
            if (field && field.other_table)
                return field.other_table;

            if (property.get_relationship() === 3 /* many_to_many */)
                return Ground.Cross_Trellis.generate_name(property.parent, property.other_trellis);

            return property.other_trellis.name;
        };

        Table.prototype.create_link = function (property) {
            var other_table = Table.get_other_table(property);
            if (!other_table)
                throw new Error('Could not find other table for ' + property.fullname());

            var type = property.type == 'reference' ? 1 /* reference */ : 0 /* identity */;

            var link = new Link_Field(property.name, this, other_table, type);

            link.property = property;

            if (this.properties[link.name])
                link.field = this.properties[link.name];

            var other_link;
            if (!other_table.trellis) {
                var other_field_name = link.field && link.field.other_field ? link.field.other_field : property.parent.name;

                other_link = new Link_Field(property.name, other_table, this, 1 /* reference */);

                other_table.links[other_link.name] = other_link;
            } else {
                var other_field_name = link.field && link.field.other_field ? link.field.other_field : property.get_other_property(true).name;

                other_link = other_table.links[other_field_name] || null;
            }

            if (other_link) {
                link.other_link = other_link;
                other_link.other_link = link;
            }

            this.links[link.name] = link;
        };

        Table.prototype.create_sql = function (ground) {
            var fields = [];
            for (var name in this.properties) {
                var property = this.properties[name];

                var field = {
                    name: property.name || name,
                    type: ground.get_base_property_type(property.type).field_type,
                    default: undefined
                };

                if (property.default !== undefined)
                    field.default = property.default;

                fields.push(field);
            }

            return Table.create_sql_from_array(this.name, fields, this.primary_keys, this.indexes);
        };

        Table.create_sql_from_array = function (table_name, source, primary_keys, indexes) {
            if (typeof primary_keys === "undefined") { primary_keys = []; }
            if (typeof indexes === "undefined") { indexes = []; }
            var fields = MetaHub.map_to_array(source, function (field, index) {
                var name = field.name || index;
                var type = field.type;

                if (!type) {
                    console.log('source', table_name, source);
                    throw new Error('Field ' + name + ' is missing a type.');
                }

                var auto_increment = primary_keys.indexOf(name) > -1 && type.search(/INT/) > -1 && primary_keys[0] == name;

                var field_sql = '`' + name + '` ' + type;
                if (auto_increment)
                    field_sql += ' AUTO_INCREMENT';

                if (field.allow_null === false) {
                    field_sql += ' NOT NULL';
                }

                if (!auto_increment && field.default !== undefined)
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
            fields = fields.concat(indexes.map(function (index) {
                return Table.generate_index_sql(index);
            }));
            var sql = 'CREATE TABLE IF NOT EXISTS `' + table_name + "` (\n";
            sql += fields.join(",\n") + "\n";
            sql += ");\n";
            return sql;
        };

        Table.prototype.create_sql_from_trellis = function (trellis) {
            if (!trellis) {
                if (!this.trellis)
                    throw new Error('No valid trellis to generate sql from.');

                trellis = this.trellis;
            }

            var indexes = this.indexes ? [].concat(this.indexes) : [];
            var core_properties = trellis.get_core_properties();
            if (Object.keys(core_properties).length === 0)
                throw new Error('Cannot create a table for ' + trellis.name + '. It does not have any core properties.');

            var fields = [];
            for (var name in core_properties) {
                var property = core_properties[name];
                var field_test = this.properties[property.name];
                if (property.is_virtual)
                    continue;

                if (field_test && field_test.share)
                    continue;

                var allow_null = property.get_allow_null();

                var default_value;
                if (allow_null) {
                    default_value = property.default !== undefined ? property.default : null;
                } else {
                    default_value = property.get_default();

                    if (default_value === null)
                        default_value = undefined;
                }

                var field = {
                    name: property.get_field_name(),
                    type: property.get_field_type(),
                    "default": default_value,
                    allow_null: allow_null
                };

                fields.push(field);

                if (property.is_unique) {
                    indexes.push({
                        name: name + '_unique_index',
                        fields: [name],
                        unique: true
                    });
                }
            }

            var primary_keys = this.get_primary_keys(trellis);

            return Table.create_sql_from_array(this.name, fields, primary_keys, indexes);
        };

        Table.prototype.get_primary_keys = function (trellis) {
            if (!this.primary_keys && trellis.parent) {
                var parent = trellis.parent;
                do {
                    if (parent.table && parent.table.primary_keys) {
                        return parent.table.primary_keys;
                    }
                } while(parent = parent.parent);
            }

            if (this.primary_keys && this.primary_keys.length > 0) {
                return this.primary_keys.map(function (name) {
                    if (!trellis.properties[name])
                        throw new Error('Error creating ' + trellis.name + '; it does not have a primary key named ' + name + '.');

                    return trellis.properties[name].get_field_name();
                });
            }

            return [trellis.properties[trellis.primary_key].get_field_name()];
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

        Table.generate_index_sql = function (index) {
            var name = index.name || '';
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
                    this.name = this.trellis.name + 's';
            }
        };
        return Table;
    })();
    Ground.Table = Table;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    

    var Link_Trellis = (function () {
        function Link_Trellis(trellises, table_name) {
            if (typeof table_name === "undefined") { table_name = null; }
            var _this = this;
            this.trellises = [];
            this.trellis_dictionary = {};
            this.trellises = trellises;

            for (var i = 0; i < trellises.length; ++i) {
                var trellis = trellises[i];
                this.trellis_dictionary[trellis.name] = trellis;
            }

            this.table_name = table_name || trellises.map(function (t) {
                return t.get_table_name();
            }).sort().join('_');

            this.identities = trellises.map(function (x) {
                return _this.create_identity(x);
            });
        }
        Link_Trellis.prototype.create_identity = function (trellis) {
            var properties = [], property, name;
            var keys = trellis.get_primary_keys();
            for (var i = 0; i < keys.length; ++i) {
                property = keys[i];
                if (property.name == trellis.primary_key)
                    name = trellis.name;
                else
                    name = trellis.name + '_' + property.name;

                properties.push(Link_Trellis.create_reference(property, name));
            }

            return {
                name: trellis.name,
                trellis: trellis,
                keys: properties
            };
        };

        Link_Trellis.create_from_property = function (property) {
            var field = property.get_field_override();
            var table_name = field ? field.other_table : null;

            var trellises = [
                property.parent,
                property.other_trellis];
            return new Link_Trellis(trellises, table_name);
        };

        Link_Trellis.create_reference = function (property, name) {
            return {
                name: name,
                type: property.type,
                property: property
            };
        };

        Link_Trellis.prototype.generate_join = function (seeds) {
            return 'JOIN ' + this.get_table_declaration() + ' ON ' + this.get_condition_string(seeds) + "\n";
        };

        Link_Trellis.prototype.generate_delete_row = function (seeds) {
            return 'DELETE ' + this.table_name + ' ON ' + this.get_condition_string(seeds) + "\n";
        };

        Link_Trellis.prototype.generate_insert = function (seeds) {
            var values = [], keys = [];

            for (var i in this.identities) {
                var identity = this.identities[i], seed = seeds[identity.trellis.name];
                for (var p in identity.keys) {
                    var key = identity.keys[p], value;
                    keys.push(key.name);
                    if (typeof seed === 'object')
                        value = seed[key.property.name];
                    else
                        value = seed;

                    values.push(key.property.get_sql_value(value));
                }
            }

            return 'REPLACE INTO ' + this.table_name + ' (`' + keys.join('`, `') + '`) VALUES (' + values.join(', ') + ');\n';
        };

        Link_Trellis.prototype.generate_table_name = function () {
            var temp = MetaHub.map_to_array(this.identities, function (p) {
                return p.parent.get_table_name();
            });
            temp = temp.sort();
            this.table_name = temp.join('_');
        };

        Link_Trellis.prototype.get_key_condition = function (key, seed, fill_blanks) {
            if (typeof fill_blanks === "undefined") { fill_blanks = false; }
            if (!seed) {
                console.log('empty key');
            }
            if (typeof seed === 'string' || typeof seed === 'number')
                return this.table_name + '.' + key.name + ' = ' + seed;

            if (seed[key.property.name] !== undefined) {
                var value = seed[key.property.name];
                if (typeof value === 'function')
                    value == value();
                else if (typeof value === 'string' && value[0] == ':')
                    value = value;
                else
                    value = key.property.get_sql_value(value);

                return this.table_name + '.' + key.name + ' = ' + value;
            } else if (fill_blanks) {
                return this.table_name + '.' + key.name + ' = ' + key.property.query();
            }

            return null;
        };

        Link_Trellis.prototype.get_condition_string = function (seeds) {
            return this.get_conditions(seeds).join(' AND ');
        };

        Link_Trellis.prototype.get_identity_conditions = function (identity, seed, fill_blanks) {
            if (typeof fill_blanks === "undefined") { fill_blanks = false; }
            var conditions = [];
            for (var p in identity.keys) {
                var key = identity.keys[p];
                var condition = this.get_key_condition(key, seed, fill_blanks);
                if (condition)
                    conditions.push(condition);
            }

            return conditions;
        };

        Link_Trellis.prototype.get_conditions = function (seeds) {
            var table_name = typeof this.alias === 'string' ? this.alias : this.table_name;
            var conditions = [];
            for (var i in this.identities) {
                var identity = this.identities[i], seed = seeds[identity.trellis.name];
                if (!seed) {
                    var other_identity = this.identities[1 - i];
                    for (var p in identity.keys) {
                        var key = identity.keys[p], other_key = other_identity.keys[p];
                        conditions.push(table_name + '.' + key.name + ' = `' + identity.trellis.get_table_name() + '`.' + key.property.name);
                    }
                } else {
                    conditions = conditions.concat(this.get_identity_conditions(identity, seed));
                }
            }

            return conditions;
        };

        Link_Trellis.prototype.get_identity_by_trellis = function (trellis) {
            for (var i = 0; i < this.identities.length; ++i) {
                var identity = this.identities[i];
                if (identity.trellis === trellis)
                    return identity;
            }

            return null;
        };

        Link_Trellis.prototype.get_table_declaration = function () {
            return typeof this.alias === 'string' ? this.table_name + ' ' + this.alias : this.table_name;
        };
        return Link_Trellis;
    })();
    Ground.Link_Trellis = Link_Trellis;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    (function (SQL) {
        function get_link_sql_value(link, value) {
            if (this.property)
                return this.property.get_sql_value(value);

            return this.other_property.property.get_other_property(true).get_sql_value(value);
        }
        SQL.get_link_sql_value = get_link_sql_value;
    })(Ground.SQL || (Ground.SQL = {}));
    var SQL = Ground.SQL;
})(Ground || (Ground = {}));
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
            this.insert = null;
            this.other_property = null;
            this.other_trellis = null;
            this.other_trellis_name = null;
            this.is_private = false;
            this.is_parent = false;
            this.is_readonly = false;
            this.is_virtual = false;
            this.is_composite_sub = false;
            this.is_unique = false;
            this.composite_properties = null;
            this.access = 'auto';
            for (var i in source) {
                if (this.hasOwnProperty(i))
                    this[i] = source[i];
            }
            if (source['default'] !== undefined)
                this.default = source['default'];

            if (source['allow_null'] !== undefined)
                this.allow_null = source['allow_null'];

            if (source.trellis) {
                this.other_trellis_name = source.trellis;
            }

            this.name = name;
            this.parent = trellis;
        }
        Property.prototype.initialize_composite_reference = function (other_trellis) {
        };

        Property.prototype.fullname = function () {
            return this.parent.name + '.' + this.name;
        };

        Property.prototype.get_allow_null = function () {
            if (this.allow_null !== undefined)
                return this.allow_null;

            var type = this.get_property_type();
            if (type && type.allow_null !== undefined)
                return type.allow_null;

            return false;
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
            var result;
            if (this.default == undefined && this.parent.parent && this.parent.parent.properties[this.name])
                result = this.parent.parent.properties[this.name].get_default();
            else
                result = this.default;

            if (result === undefined) {
                var type = this.get_property_type();
                if (type)
                    result = type.default_value;
            }
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
            if (this.type == 'reference') {
                var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key];
                return other_primary_property.get_field_type();
            }
            var property_type = this.get_property_type();
            if (!property_type)
                throw new Error(this.name + ' could not find valid field type: ' + this.type);

            return property_type.get_field_type();
        };

        Property.prototype.get_seed_name = function () {
            if (this.is_composite_sub)
                return this.other_property;
            else
                return this.name;
        };

        Property.prototype.get_sql_value = function (value, type, is_reference) {
            if (typeof type === "undefined") { type = null; }
            if (typeof is_reference === "undefined") { is_reference = false; }
            type = type || this.type;
            var property_type = this.parent.ground.property_types[type];
            if (value === undefined || value === null) {
                value = this.get_default();
                if (value === undefined || value === null) {
                    if (!this.get_allow_null() && !is_reference)
                        throw new Error(this.fullname() + ' does not allow null values.');
                }
            }

            if (property_type && property_type.parent)
                return this.get_sql_value(value, property_type.parent.name, is_reference);

            if (this.parent.primary_key == this.name) {
                value = this.parent.get_identity2(value);
            }

            switch (type) {
                case 'guid':
                    if (!value)
                        return 'NULL';

                    return "UNHEX('" + value.toUpperCase().replace(/[^A-Z0-9]/g, '') + "')";
                case 'list':

                case 'reference':
                    var other_primary_property = this.other_trellis.properties[this.other_trellis.primary_key];
                    if (value && typeof value === 'object') {
                        value = value[this.other_trellis.primary_key];
                        if (!value)
                            return null;
                    }
                    return other_primary_property.get_sql_value(value, null, true);

                case 'int':
                    if (!value)
                        return 0;

                    if (typeof value === 'string' && !value.match(/^-?\d+$/))
                        throw new Error(this.fullname() + ' expected an integer but recieved: ' + value);

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

                    var num = parseFloat(value);
                    if (num == NaN)
                        throw new Error(this.fullname() + ' expected an integer but recieved: ' + value);

                    return num;
                case 'money':
                    if (typeof value !== 'number')
                        return parseFloat(value.toString());
            }

            throw new Error('Ground is not configured to process property types of ' + type + ' (' + this.type + ')');
        };

        Property.prototype.get_type = function () {
            if (this.type == 'reference' || this.type == 'list') {
                return this.other_trellis.properties[this.other_trellis.primary_key].type;
            }

            return this.type;
        };

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
                var properties = this.other_trellis.get_all_properties();
                var other_property = properties[this.other_property];
                if (!other_property) {
                    throw new Error('Invalid other property in ' + this.get_field_name() + ": " + this.other_trellis.name + '.' + this.other_property + ' does not exist.');
                }
                return other_property;
            } else {
                if (!this.other_trellis) {
                    if (create_if_none)
                        throw new Error("Attempt to get other property for " + this.get_field_name() + " but its other_trellis is null.");

                    return null;
                }

                for (var name in this.other_trellis.properties) {
                    property = this.other_trellis.properties[name];
                    if (property.other_trellis === this.parent) {
                        return property;
                    }
                }
            }

            if (this.other_trellis === this.parent) {
                if (create_if_none)
                    return this;

                return null;
            }

            if (!create_if_none)
                return null;

            var attributes = {};
            attributes.type = 'list';
            attributes.is_virtual = true;
            attributes.trellis = this.parent.name;
            var result = new Property(this.other_trellis.name, attributes, this.other_trellis);
            result.other_trellis = this.parent;
            return result;
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

        Property.prototype.export_schema = function () {
            var result = {
                type: this.type
            };
            if (this.other_trellis)
                result.trellis = this.other_trellis.name;

            if (this.is_virtual)
                result.is_virtual = true;

            if (this.insert)
                result.insert = this.insert;

            if (this.is_readonly)
                result.is_readonly = true;

            if (this.default !== undefined)
                result['default'] = this.default;

            if (this.allow_null)
                result.allow_null = true;

            return result;
        };
        return Property;
    })();
    Ground.Property = Property;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Expression_Types = [
        'value',
        'function'
    ];

    var Expression_Engine = (function () {
        function Expression_Engine() {
        }
        Expression_Engine.resolve = function (expression, context) {
            if (typeof expression === 'string') {
                if (typeof expression === 'string' && context.properties[expression] !== undefined) {
                    return context.properties[expression];
                }
            } else if (expression && typeof expression === 'object') {
                if (expression.type == 'function') {
                    return Expression_Engine.resolve_function(expression, context);
                }

                if (expression.type == 'literal') {
                    return expression.value;
                }
            }
        };

        Expression_Engine.resolve_function = function (expression, context) {
            if (expression.name == 'sum') {
            }
        };
        return Expression_Engine;
    })();
    Ground.Expression_Engine = Expression_Engine;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Record_Count = (function (_super) {
        __extends(Record_Count, _super);
        function Record_Count(ground, parent, property_name, count_name) {
            var _this = this;
            _super.call(this);
            this.ground = ground;
            this.parent = ground.sanitize_trellis_argument(parent);
            var property = this.parent.get_property(property_name);
            this.child = property.other_trellis;
            this.count_name = count_name;

            this.listen(ground, this.child.name + '.created', function (seed, update) {
                return _this.count(seed);
            });
            this.listen(ground, this.child.name + '.deleted', function (seed, update) {
                return _this.count(seed);
            });
        }
        Record_Count.prototype.count = function (seed) {
            var _this = this;
            var back_reference = this.child.get_reference_property(this.parent);
            return this.child.assure_properties(seed, [back_reference.name]).then(function (seed) {
                var parent_key = back_reference.get_sql_value(seed[back_reference.name]);

                var sql = "UPDATE " + _this.parent.get_table_name() + "\nSET " + _this.count_name + " =" + "\n(SELECT COUNT(*)" + "\nFROM " + _this.child.get_table_name() + " WHERE " + back_reference.query() + " = " + parent_key + ")" + "\nWHERE " + _this.parent.query_primary_key() + " = " + parent_key;

                return _this.ground.db.query(sql, [parent_key]).then(function () {
                    return _this.invoke('changed', parent_key);
                });
            });
        };
        return Record_Count;
    })(MetaHub.Meta_Object);
    Ground.Record_Count = Record_Count;

    var Join_Count = (function (_super) {
        __extends(Join_Count, _super);
        function Join_Count(ground, property, count_name) {
            var _this = this;
            _super.call(this);
            this.ground = ground;
            this.parent = property.parent;
            this.count_name = count_name;
            this.link = new Ground.Cross_Trellis(property);
            this.link.alias = this.link.name;
            this.property = property;

            var table_name = this.link.get_table_name();
            this.listen(ground, table_name + '.created', function (seed, property) {
                return _this.count(seed, property);
            });
            this.listen(ground, table_name + '.removed', function (seed, property) {
                return _this.count(seed, property);
            });
        }
        Join_Count.prototype.count = function (seed, property) {
            var _this = this;
            var key_name;
            if (property == this.property) {
                key_name = this.property.parent.primary_key;
            } else {
                key_name = property.name;
            }

            return property.parent.assure_properties(seed, [key_name]).then(function (seed) {
                var trellis = _this.property.parent;

                var initial_key_value = MetaHub.is_array(seed[key_name]) ? seed[key_name][0] : seed[key_name];

                var key = trellis.get_primary_property().get_sql_value(initial_key_value);
                var identities = _this.link.order_identities(_this.property);

                var sql = "UPDATE " + _this.parent.get_table_name() + "\nSET " + _this.count_name + " =" + "\n(SELECT COUNT(*)" + "\nFROM " + _this.link.get_table_name() + "\nWHERE " + identities[0].query() + ' = ' + trellis.query_primary_key() + ")" + "\nWHERE " + trellis.query_primary_key() + " = " + key;

                return _this.ground.db.query(sql).then(function () {
                    return _this.invoke('changed', key);
                });
            });
        };
        return Join_Count;
    })(MetaHub.Meta_Object);
    Ground.Join_Count = Join_Count;

    var Multi_Count = (function (_super) {
        __extends(Multi_Count, _super);
        function Multi_Count(ground, trellis, count_name, sources) {
            var _this = this;
            _super.call(this);
            this.ground = ground;
            this.trellis = ground.trellises[trellis];
            this.count_name = count_name;
            this.count_fields = sources.map(function (c) {
                return c['count_name'];
            });
            for (var i in sources) {
                this.listen(sources[i], 'changed', function (key) {
                    return _this.count(key);
                });
            }
        }
        Multi_Count.prototype.count = function (key) {
            var _this = this;
            var trellis = this.trellis;

            var sql = "UPDATE " + trellis.get_table_name() + " SET " + this.count_name + " =\n" + this.count_fields.join(' + ') + " " + "WHERE " + trellis.query_primary_key() + " = ?";

            return this.ground.db.query(sql, [key]).then(function () {
                return _this.invoke('changed');
            });
        };
        return Multi_Count;
    })(MetaHub.Meta_Object);
    Ground.Multi_Count = Multi_Count;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    

    var Scope = (function () {
        function Scope() {
            this.symbols = {};
        }
        Scope.prototype.add_symbol = function (name, value) {
            this.symbols[name] = value;
        };
        return Scope;
    })();
    Ground.Scope = Scope;

    var Logic = (function () {
        function Logic() {
        }
        Logic.load = function (ground, statements) {
            var scope = new Scope();

            for (var i = 0; i < statements.length; ++i) {
                var statement = statements[i];
                switch (statement.type) {
                    case 'constraint':
                        Logic.load_constraint(ground, statement, scope);
                        break;
                    case 'symbol':
                        Logic.create_symbol(ground, statement, scope);
                        break;
                }
            }
        };

        Logic.load_constraint = function (ground, source, scope) {
            if (source.expression.type == 'function') {
                var func = source.expression;
                if (func.name == 'count') {
                    var reference = func.arguments[0];
                    var trellis = ground.sanitize_trellis_argument(source.trellis);
                    var property = trellis.get_property(reference.path);
                    if (property.get_relationship() !== 3 /* many_to_many */)
                        return new Ground.Record_Count(ground, source.trellis, reference.path, source.property);
                    else
                        return new Ground.Join_Count(ground, property, source.property);
                } else if (func.name == 'sum') {
                    var sources = func.arguments.map(function (x) {
                        return scope.symbols[x.path];
                    });
                    return new Ground.Multi_Count(ground, source.trellis, source.property, sources);
                }
            }
        };

        Logic.create_symbol = function (ground, source, scope) {
            var value = Logic.load_constraint(ground, source.expression, scope);
            scope.add_symbol(source.name, value);
        };
        return Logic;
    })();
    Ground.Logic = Logic;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    

    var Join_Trellis_Wrapper = (function () {
        function Join_Trellis_Wrapper(trellis, alias) {
            if (typeof alias === "undefined") { alias = null; }
            this.trellis = trellis;
            var trellis_table_name = trellis ? trellis.get_table_name() : null;
            this.alias = alias || trellis_table_name;
        }
        Join_Trellis_Wrapper.create_using_property = function (trellis, property) {
            var alias = Join.generate_table_name(trellis, property);
            return new Join_Trellis_Wrapper(trellis, alias);
        };

        Join_Trellis_Wrapper.prototype.get_alias = function () {
            return this.alias;
        };

        Join_Trellis_Wrapper.prototype.get_primary_keys = function () {
            return [Join_Property.create_from_property(this.trellis.get_primary_property())];
        };

        Join_Trellis_Wrapper.prototype.get_table_name = function () {
            return this.trellis.get_table_name();
        };

        Join_Trellis_Wrapper.prototype.query_identity = function () {
            return this.get_alias() + '.' + this.trellis.get_primary_property().get_field_name();
        };
        return Join_Trellis_Wrapper;
    })();
    Ground.Join_Trellis_Wrapper = Join_Trellis_Wrapper;

    var Cross_Trellis = (function () {
        function Cross_Trellis(property) {
            var field = property.get_field_override();
            this.name = field ? field.other_table : Cross_Trellis.generate_name(property.parent, property.other_trellis);

            this.alias = 'cross_' + this.name + '_' + property.name;
            this.properties = Cross_Trellis.create_properties(this, property);
            this.identities = [this.properties[1], this.properties[2]];
        }
        Cross_Trellis.generate_name = function (first, second) {
            var names = [first.get_table_name(), second.get_table_name()];
            var temp = names.sort();
            return temp.join('_');
        };

        Cross_Trellis.get_field_name = function (property) {
            var field = property.get_field_override();
            if (field && field.other_field)
                return field.other_field;

            return property.parent.name;
        };

        Cross_Trellis.prototype.get_primary_keys = function () {
            return this.identities;
        };

        Cross_Trellis.create_properties = function (cross, property) {
            var other_property = property.get_other_property(true);

            var result = [
                Join_Property.create_from_property(property, cross),
                new Join_Property(cross, new Join_Trellis_Wrapper(property.parent), Cross_Trellis.get_field_name(property), "reference"),
                new Join_Property(cross, new Join_Trellis_Wrapper(property.other_trellis), Cross_Trellis.get_field_name(other_property), "reference"),
                Join_Property.create_from_property(other_property, cross)
            ];

            Join_Property.pair(result[0], result[1]);
            Join_Property.pair(result[2], result[3]);
            return result;
        };

        Cross_Trellis.prototype.generate_delete = function (property, owner, other) {
            var identities = this.order_identities(property);
            var conditions = [
                identities[0].get_comparison(owner),
                identities[1].get_comparison(other)
            ];
            return 'DELETE FROM ' + this.get_table_name() + ' WHERE ' + conditions.join(' AND ') + "\n";
        };

        Cross_Trellis.prototype.generate_insert = function (property, owner, other) {
            var identities = this.order_identities(property);
            var keys = identities.map(function (x) {
                return x.field_name;
            });
            var values = [
                identities[0].get_sql_value(owner),
                identities[1].get_sql_value(other)
            ];

            return 'REPLACE INTO ' + this.get_table_name() + ' (`' + keys.join('`, `') + '`) VALUES (' + values.join(', ') + ');\n';
        };

        Cross_Trellis.prototype.order_identities = function (property) {
            var first = this.identities.filter(function (x) {
                return x.other_property.name == property.name;
            })[0];
            if (!first) {
                throw new Error('Could not insert into cross table ' + this.get_table_name() + '.  Could not find identity for property ' + property.fullname() + '.');
            }
            var second = this.identities[1 - this.identities.indexOf(first)];
            return [first, second];
        };

        Cross_Trellis.prototype.get_alias = function () {
            return this.alias;
        };

        Cross_Trellis.prototype.get_table_name = function () {
            return this.name;
        };

        Cross_Trellis.prototype.query_identity = function () {
            throw new Error('Cross_Trellis.query_identity() should never be called.' + '  Cross_Reference only has references, not identities');
        };
        return Cross_Trellis;
    })();
    Ground.Cross_Trellis = Cross_Trellis;

    var Cross_Trellis2 = (function () {
        function Cross_Trellis2(property, alias) {
            if (typeof alias === "undefined") { alias = null; }
            this.table = Ground.Table.get_other_table(property);
            this.alias = alias;
        }
        Cross_Trellis2.prototype.generate_insert = function (property, owner, other) {
            var identities = this.order_identities(property);
            var keys = identities.map(function (x) {
                return x.name;
            });
            var values = [
                Ground.SQL.get_link_sql_value(identities[0], owner),
                Ground.SQL.get_link_sql_value(identities[1], other)
            ];

            return 'REPLACE INTO ' + this.table.name + ' (`' + keys.join('`, `') + '`) VALUES (' + values.join(', ') + ');\n';
        };

        Cross_Trellis2.prototype.order_identities = function (property) {
            var table = this.table;
            var first = MetaHub.filter(table.links, function (x) {
                return x.name == property.name;
            })[0];
            if (!first) {
                throw new Error('Could not operate using cross table ' + this.table.name + '.  Could not find identity for property ' + property.fullname() + '.');
            }
            MetaHub.filter(table.links, function (x) {
                return x.name == property.name;
            })[0];
            var second = MetaHub.filter(table.links, function (x) {
                return x.name == property.name;
            })[0];
            return [first, second];
        };
        return Cross_Trellis2;
    })();
    Ground.Cross_Trellis2 = Cross_Trellis2;

    var Join_Property = (function () {
        function Join_Property(parent, other_trellis, name, type, field_name, other_property) {
            if (typeof field_name === "undefined") { field_name = null; }
            if (typeof other_property === "undefined") { other_property = null; }
            this.parent = parent;
            this.name = name;
            this.other_trellis = other_trellis;
            this.field_name = field_name || name;
            this.type = type;
            this.other_property = other_property;
        }
        Join_Property.create_from_property = function (property, other_trellis, other_property) {
            if (typeof other_trellis === "undefined") { other_trellis = null; }
            if (typeof other_property === "undefined") { other_property = null; }
            var result = new Join_Property(new Join_Trellis_Wrapper(property.parent), other_trellis || new Join_Trellis_Wrapper(property.other_trellis), property.name, property.type, property.get_field_name(), other_property);

            result.property = property;
            return result;
        };

        Join_Property.prototype.get_comparison = function (value) {
            return this.query() + ' = ' + this.get_sql_value(value);
        };

        Join_Property.prototype.query = function () {
            var table_name = this.parent.get_alias() || this.parent.get_table_name();
            return table_name + '.' + this.field_name;
        };

        Join_Property.pair = function (first, second) {
            first.other_property = second;
            second.other_property = first;
        };

        Join_Property.prototype.get_sql_value = function (value) {
            if (this.property)
                return this.property.get_sql_value(value);

            return this.other_property.property.get_other_property(true).get_sql_value(value);
        };
        return Join_Property;
    })();
    Ground.Join_Property = Join_Property;

    var Join_Tree = (function () {
        function Join_Tree(property, trellis) {
            this.children = [];
            this.property = property;
            this.trellis = trellis;
        }
        Join_Tree.get = function (tree, property, next) {
            for (var i = 0; i < tree.length; ++i) {
                var branch = tree[i];
                if (branch.property.name == property.name && branch.trellis.name === next.name)
                    return branch;
            }
            return null;
        };
        return Join_Tree;
    })();
    Ground.Join_Tree = Join_Tree;

    var Join = (function () {
        function Join() {
        }
        Join.generate_table_name = function (trellis, property) {
            return 'link_' + trellis.name + '_' + property.get_field_name() + '_' + property.parent.name;
        };

        Join.get_last_reference = function (property_chain) {
            var property = property_chain[property_chain.length - 1];

            if (!property.other_property)
                return property_chain[property_chain.length - 2];
        };

        Join.paths_to_tree = function (base, paths) {
            var result = [], target, path;

            for (var i = 0; i < paths.length; ++i) {
                var trellis = base;
                path = paths[i];
                target = result;
                for (var x = 0; x < path.length - 1; ++x) {
                    var property = path[x];
                    var next = path[x + 1].parent;
                    var branch = Join_Tree.get(target, property, next);
                    if (!branch) {
                        branch = new Join_Tree(property, next);
                        target.push(branch);
                    }
                    target = branch.children;
                }
            }

            return result;
        };

        Join.convert = function (branch, previous, result) {
            var join_property, cross, join_trellis;
            if (branch.property.get_relationship() == 3 /* many_to_many */) {
                cross = new Cross_Trellis(branch.property);
                result.push(new Reference_Join(cross.properties[0], previous, cross));
                previous = cross;
                join_property = cross.properties[2];
            } else {
                join_property = Join_Property.create_from_property(branch.property);
                Join_Property.pair(join_property, Join_Property.create_from_property(branch.property.get_other_property(true)));
            }

            var other_property = branch.property.get_other_property(true);

            if (branch.property.type == 'list' && other_property.parent !== branch.trellis) {
                join_trellis = Join_Trellis_Wrapper.create_using_property(branch.trellis, branch.property);
                var alias = 'composite_' + join_trellis.alias + '_' + branch.property.other_trellis.name;
                var join_trellis2 = new Join_Trellis_Wrapper(branch.property.other_trellis, alias);
                result.push(new Reference_Join(join_property, previous, join_trellis2));

                result.push(new Composite_Join(join_trellis2, join_trellis));
                return join_trellis;
            } else {
                join_trellis = Join_Trellis_Wrapper.create_using_property(branch.trellis, branch.property);
                result.push(new Reference_Join(join_property, previous, join_trellis));
                return join_trellis;
            }
        };

        Join.tree_to_joins = function (tree, previous) {
            if (typeof previous === "undefined") { previous = null; }
            var result = [], base;

            for (var i = 0; i < tree.length; ++i) {
                var branch = tree[i], cross = null;
                if (!previous) {
                    base = new Join_Trellis_Wrapper(branch.property.parent);
                }
                var join_trellis = Join.convert(branch, previous || base, result);
                result = result.concat(Join.tree_to_joins(branch.children, join_trellis));
            }

            return result;
        };

        Join.render_paths = function (trellis, paths) {
            var tree = Join.paths_to_tree(trellis, paths);
            var joins = Join.tree_to_joins(tree);
            return joins.map(function (join) {
                return join.render();
            });
        };

        Join.path_to_property_chain = function (base, path) {
            var parts = Ground.path_to_array(path);
            var trellis = base;
            var result = [];

            for (var i = 0; i < parts.length; ++i) {
                var part = parts[i];
                var property = trellis.get_property(part);

                result.push(property);
                trellis = property.other_trellis;
            }

            return result;
        };

        Join.get_end_query = function (property_chain) {
            var last_property = property_chain[property_chain.length - 1];
            if (property_chain.length == 1 && last_property.get_relationship() != 3 /* many_to_many */)
                return last_property.parent.get_table_name() + '.' + last_property.get_field_name();

            var last_reference = Join.get_last_reference(property_chain);
            var table_name = Join.generate_table_name(last_property.parent, last_reference);
            return table_name + '.' + last_property.get_field_name();
        };
        return Join;
    })();
    Ground.Join = Join;

    var Reference_Join = (function () {
        function Reference_Join(property, first, second) {
            this.property = property;
            this.first = first;
            this.second = second;
        }
        Reference_Join.prototype.render = function () {
            return 'LEFT JOIN ' + this.second.get_table_name() + ' ' + this.second.get_alias() + ' ON ' + this.get_condition();
        };

        Reference_Join.prototype.get_condition = function () {
            if (this.property.type === 'reference')
                return this.get_query_reference(this.first, this.property) + ' = ' + this.second.query_identity();
            else
                return this.first.query_identity() + ' = ' + this.get_query_reference(this.second, this.property.other_property);
        };

        Reference_Join.prototype.get_query_reference = function (trellis, property) {
            return trellis.get_alias() + '.' + property.field_name;
        };
        return Reference_Join;
    })();
    Ground.Reference_Join = Reference_Join;

    var Composite_Join = (function () {
        function Composite_Join(first, second) {
            this.first = first;
            this.second = second;
        }
        Composite_Join.prototype.render = function () {
            return 'LEFT JOIN ' + this.second.get_table_name() + ' ' + this.second.get_alias() + ' ON ' + this.get_condition();
        };

        Composite_Join.prototype.get_condition = function () {
            return this.first.query_identity() + ' = ' + this.second.query_identity();
        };
        return Composite_Join;
    })();
    Ground.Composite_Join = Composite_Join;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    

    var Query_Builder = (function () {
        function Query_Builder(trellis) {
            this.type = 'query';
            this.sorts = [];
            this.include_links = false;
            this.transforms = [];
            this.subqueries = {};
            this.map = {};
            this.queries = undefined;
            this.filters = [];
            this.trellis = trellis;
            this.ground = trellis.ground;
        }
        Query_Builder.add_operator = function (symbol, action) {
            Query_Builder.operators[symbol] = action;
        };

        Query_Builder.prototype.add_filter = function (path, value, operator) {
            if (typeof value === "undefined") { value = null; }
            if (typeof operator === "undefined") { operator = '='; }
            if (Query_Builder.operators[operator] === undefined)
                throw new Error("Invalid operator: '" + operator + "'.");

            if (value === undefined)
                throw new Error('Cannot add property filter where value is undefined; property = ' + this.trellis.name + '.' + path + '.');

            var filter = {
                path: path,
                value: value,
                operator: operator
            };

            if (path.indexOf('.') === -1) {
                var properties = this.trellis.get_all_properties();
                filter.property = properties[path];
            }

            this.filters.push(filter);
        };

        Query_Builder.prototype.create_condition = function (source) {
            var _this = this;
            if (source.type == "or" || source.type == "and") {
                return {
                    type: source.type,
                    expressions: source.expressions.map(function (x) {
                        return _this.create_condition(source);
                    })
                };
            } else {
                if (Query_Builder.operators[source.operator] === undefined)
                    throw new Error("Invalid operator: '" + source.operator + "'.");

                if (source.value === undefined) {
                    throw new Error('Cannot add property filter where value is undefined; property = ' + this.trellis.name + '.' + source.path + '.');
                }

                return {
                    path: Ground.Query_Renderer.get_chain(source.path, this.trellis),
                    value: source.value,
                    operator: source.operator
                };
            }
        };

        Query_Builder.prototype.add_key_filter = function (value) {
            this.add_filter(this.trellis.primary_key, value);
        };

        Query_Builder.prototype.add_sort = function (sort) {
            this.sorts.push(sort);
        };

        Query_Builder.prototype.add_map = function (target, source) {
            if (typeof source === "undefined") { source = null; }
            this.map[target] = source;
        };

        Query_Builder.prototype.add_query = function (source) {
            var trellis = this.ground.sanitize_trellis_argument(source.trellis);
            var query = new Query_Builder(trellis);
            this.queries = this.queries || [];
            this.queries.push(query);
            query.extend(source);

            return query;
        };

        Query_Builder.prototype.add_subquery = function (property_name, source) {
            if (typeof source === "undefined") { source = null; }
            var properties = this.trellis.get_all_properties();
            var property = properties[property_name];
            if (!property)
                throw new Error('Cannot create subquery. ' + this.trellis.name + ' does not have a property named ' + property_name + '.');

            if (!property.other_trellis)
                throw new Error('Cannot create a subquery from ' + property.fullname() + ' it does not reference another trellis.');

            var query = this.subqueries[property_name];
            if (!query) {
                query = new Query_Builder(property.other_trellis);
                query.include_links = false;
                this.subqueries[property_name] = query;
            }

            query.extend(source);
            return query;
        };

        Query_Builder.prototype.add_transform_clause = function (clause) {
            this.transforms.push({
                clause: clause
            });
        };

        Query_Builder.prototype.create_runner = function () {
            return new Ground.Query_Runner(this);
        };

        Query_Builder.create_join_filter = function (property, seed) {
            var value = property.parent.get_identity(seed);
            if (value === undefined || value === null)
                throw new Error(property.fullname() + ' could not get a valid identity from the provided seed.');

            var other_property = property.get_other_property(true);
            return {
                path: other_property.name,
                property: other_property,
                value: value,
                operator: '='
            };
        };

        Query_Builder.prototype.extend = function (source) {
            if (!source)
                return;

            if (typeof source.type === 'string')
                this.type = source.type;

            var i;
            this.source = source;

            if (source.filters) {
                for (i = 0; i < source.filters.length; ++i) {
                    var filter = source.filters[i];
                    this.add_filter(filter.path || filter.property, filter.value, filter.operator);
                }
            }

            if (source.condition) {
                this.condition = this.create_condition(source.condition);
            }

            if (source.sorts) {
                for (i = 0; i < source.sorts.length; ++i) {
                    this.add_sort(source.sorts[i]);
                }
            }

            if (source.pager) {
                this.pager = source.pager;
            }

            if (source.type === 'union') {
                for (i = 0; i < source.queries.length; ++i) {
                    this.add_query(source.queries[i]);
                }
            } else {
                if (source.properties) {
                    var properties = this.trellis.get_all_properties();
                    this.properties = {};
                    for (var i in source.properties) {
                        var property = source.properties[i];
                        if (typeof property == 'string') {
                            if (!properties[property])
                                throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + property + '.');

                            this.properties[property] = {};
                        } else {
                            var name = property.name || i;
                            if (!properties[name])
                                throw new Error('Error with overriding query properties: ' + this.trellis.name + ' does not have a property named ' + name + '.');

                            if (property)
                                this.properties[name] = property;
                        }
                    }

                    var identities = [this.trellis.properties[this.trellis.primary_key]];
                    if (identities[0].composite_properties && identities[0].composite_properties.length > 0) {
                        identities = identities.concat(identities[0].composite_properties);
                    }

                    for (var k in identities) {
                        var identity = identities[k];
                        if (!this.properties[identity.name])
                            this.properties[identity.name] = {};
                    }
                }
            }

            if (typeof source.subqueries == 'object') {
                for (i in source.subqueries) {
                    this.add_subquery(i, source.subqueries[i]);
                }
            }

            if (typeof source.map == 'object') {
                for (i in source.map) {
                    this.add_map(i, source.map[i]);
                }
            }

            if (MetaHub.is_array(source.expansions)) {
                for (i = 0; i < source.expansions.length; ++i) {
                    var expansion = source.expansions[i];
                    var tokens = expansion.split('/');
                    var subquery = this;
                    for (var j = 0; j < tokens.length; ++j) {
                        subquery = subquery.add_subquery(tokens[j], {});
                    }
                }
            }
        };

        Query_Builder.prototype.get_primary_key_value = function () {
            var _this = this;
            var filters = this.filters.filter(function (filter) {
                return filter.path == _this.trellis.primary_key;
            });
            if (filters.length > 0)
                return filters[0].value;

            return undefined;
        };

        Query_Builder.prototype.run = function () {
            var runner = new Ground.Query_Runner(this);

            return runner.run();
        };

        Query_Builder.prototype.run_single = function () {
            return this.run().then(function (result) {
                return result.objects[0];
            });
        };
        Query_Builder.operators = {
            '=': null,
            'LIKE': {
                "render": function (result, filter, property, data) {
                    if (data.value !== null)
                        data.value = "'%" + data.value + "%'";
                }
            },
            '!=': null,
            '<': null,
            '>': null,
            '<=': null,
            '>=': null,
            '=>': null,
            '=<': null
        };
        return Query_Builder;
    })();
    Ground.Query_Builder = Query_Builder;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Query_Renderer = (function () {
        function Query_Renderer(ground) {
            this.ground = ground;
        }
        Query_Renderer.apply_arguments = function (sql, args) {
            for (var pattern in args) {
                var value = args[pattern];
                sql = sql.replace(new RegExp(pattern, 'g'), value);
            }

            return sql;
        };

        Query_Renderer.get_properties = function (source) {
            if (source.properties && Object.keys(source.properties).length > 0) {
                var properties = source.trellis.get_all_properties();
                return MetaHub.map(source.properties, function (property, key) {
                    return properties[key];
                });
            } else {
                return source.trellis.get_all_properties();
            }
        };

        Query_Renderer.generate_property_join = function (property, seeds) {
            var join = Ground.Link_Trellis.create_from_property(property);
            console.log('join', property.name, seeds);
            return join.generate_join(seeds);
        };

        Query_Renderer.prototype.generate_sql = function (parts, source) {
            var sql = 'SELECT ' + parts.fields + parts.from + parts.joins + parts.filters + parts.sorts;

            for (var i = 0; i < source.transforms.length; ++i) {
                var transform = source.transforms[i];
                var temp_table = 'transform_' + (i + 1);
                sql = 'SELECT * FROM (' + sql + ' ) ' + temp_table + ' ' + transform.clause;
            }

            sql = Query_Renderer.apply_arguments(sql, parts.args) + parts.pager;

            return sql;
        };

        Query_Renderer.prototype.generate_count = function (parts) {
            var sql = 'SELECT COUNT(*) AS total_number' + parts.from + parts.joins + parts.filters;

            sql = Query_Renderer.apply_arguments(sql, parts.args);

            return sql;
        };

        Query_Renderer.prototype.generate_union = function (parts, queries, source) {
            var alias = source.trellis.get_table_name();
            var sql = 'SELECT DISTINCT * FROM (' + queries.join('\nUNION\n') + '\n) ' + alias + '\n' + parts.filters + parts.sorts;

            sql = Query_Renderer.apply_arguments(sql, parts.args) + parts.pager;

            return sql;
        };

        Query_Renderer.prototype.generate_union_count = function (parts, queries, source) {
            var alias = source.trellis.get_table_name();
            var sql = 'SELECT COUNT(DISTINCT ' + source.trellis.query() + ') AS total_number FROM (' + queries.join('\nUNION\n') + '\n) ' + alias + '\n' + parts.filters + parts.sorts;

            sql = Query_Renderer.apply_arguments(sql, parts.args);

            return sql;
        };

        Query_Renderer.prototype.generate_parts = function (source, query_id) {
            if (typeof query_id === "undefined") { query_id = undefined; }
            var properties = Query_Renderer.get_properties(source);
            var data = Query_Renderer.get_fields_and_joins(source, properties);
            var data2 = Query_Renderer.build_filters(source, this.ground);
            var sorts = source.sorts.length > 0 ? Query_Renderer.process_sorts(source.sorts, source.trellis, data2) : null;

            var fields = data.fields;
            var joins = data.joins.concat(Ground.Join.render_paths(source.trellis, data2.property_joins));
            var args = data2.arguments;
            var filters = data2.filters || [];
            if (fields.length == 0)
                throw new Error('No authorized fields found for trellis ' + source.trellis.name + '.');

            if (typeof query_id === 'number') {
                fields.push(query_id.toString() + ' AS _query_id_');
            }

            return {
                fields: fields.join(",\n"),
                from: "\nFROM `" + source.trellis.get_table_name() + '`',
                joins: joins.length > 0 ? "\n" + joins.join("\n") : '',
                filters: filters.length > 0 ? "\nWHERE " + filters.join(" AND ") : '',
                sorts: sorts ? ' ' + sorts : '',
                pager: source.pager ? ' ' + Query_Renderer.render_pager(source.pager) : '',
                args: args
            };
        };

        Query_Renderer.get_fields_and_joins = function (source, properties, include_primary_key) {
            if (typeof include_primary_key === "undefined") { include_primary_key = true; }
            var name, fields = [], trellises = {}, joins = [];

            var render_field = function (name) {
                var property = properties[name];

                if (property.type == 'list' || property.is_virtual)
                    return;

                if (property.name != source.trellis.primary_key || include_primary_key) {
                    var sql = property.get_field_query();
                    fields.push(sql);
                    if (property.parent.name != source.trellis.name)
                        trellises[property.parent.name] = property.parent;
                }
            };

            if (source.map && Object.keys(source.map).length > 0) {
                if (!source.map[source.trellis.primary_key])
                    render_field(source.trellis.primary_key);

                for (var name in source.map) {
                    if (!name.match(/^[\w_]+$/))
                        throw new Error('Invalid field name for mapping: ' + name + '.');

                    var expression = source.map[name];
                    if (!expression.type) {
                        render_field(name);
                    } else if (expression.type == 'literal') {
                        var value = expression.value;
                        if (value === null) {
                            value = 'NULL';
                        } else if (!expression.value.toString().match(/^[\w_]*$/))
                            throw new Error('Invalid mapping value: ' + value + '.');

                        if (typeof value === 'object') {
                            value = "'object'";
                        } else {
                            value = source.ground.convert_value(expression.value, typeof expression.value);
                            if (typeof value === 'string')
                                value = "'" + value + "'";
                        }

                        var sql = value + " AS " + name;
                        fields.push(sql);
                    } else if (expression.type == 'reference') {
                        if (!properties[expression.path])
                            throw new Error('Invalid map path: ' + expression.path + '.');

                        var sql = expression.path + " AS " + name;
                        fields.push(sql);
                    }
                }
            } else {
                for (name in properties) {
                    render_field(name);
                }
            }

            for (name in trellises) {
                var trellis = trellises[name];
                var join = source.trellis.get_ancestor_join(trellis);
                if (join)
                    joins.push(join);
            }

            return {
                fields: fields,
                joins: joins
            };
        };

        Query_Renderer.add_path = function (path, trellis, result) {
            var property_chain = Query_Renderer.get_chain(path, trellis);
            return Query_Renderer.add_chain(property_chain, result);
        };

        Query_Renderer.get_chain = function (path, trellis) {
            if (typeof path === 'string') {
                var parts = Ground.path_to_array(path);
                var property_chain = Ground.Join.path_to_property_chain(trellis, parts);
                var last = property_chain[property_chain.length - 1];
                if (last.other_trellis)
                    property_chain.push(last.other_trellis.get_primary_property());

                return property_chain;
            } else {
                return path;
            }
        };

        Query_Renderer.add_chain = function (property_chain, result) {
            var property = property_chain[property_chain.length - 1];
            if (property.get_relationship() == 3 /* many_to_many */ || property_chain.length > 1) {
                result.property_joins = result.property_joins || [];
                result.property_joins.push(property_chain);
            }

            return property_chain;
        };

        Query_Renderer.build_filter = function (source, filter, ground) {
            var result = {
                filters: [],
                arguments: {},
                property_joins: []
            };
            var value = filter.value, operator = filter.operator || '=', reference;

            var placeholder = ':' + filter.path.replace(/\./g, '_') + '_filter' + Query_Renderer.counter++;
            if (Query_Renderer.counter > 10000)
                Query_Renderer.counter = 1;

            var property_chain = Query_Renderer.add_path(filter.path, source.trellis, result);
            var property = property_chain[property_chain.length - 1];

            if (property.get_relationship() == 3 /* many_to_many */ || property_chain.length > 1) {
                reference = Ground.Join.get_end_query(property_chain);
            } else {
                reference = property.query();
            }

            var operator_action = Ground.Query_Builder.operators[filter.operator];
            if (operator_action && typeof operator_action.render === 'function') {
                var data = {
                    value: value,
                    operator: operator,
                    placeholder: placeholder,
                    reference: reference
                };
                operator_action.render(result, filter, property, data);
                value = data.value;
                placeholder = data.placeholder;
                operator = data.operator;
                reference = data.reference;
            } else {
                if (value === null || (value === 'null' && property.type != 'string')) {
                    if (!operator || operator == '=')
                        operator = 'IS';
                    else if (operator == '!=')
                        operator = 'IS NOT';

                    value = 'NULL';
                } else {
                    if (value !== null)
                        value = ground.convert_value(value, property.type);
                    value = property.get_sql_value(value);
                }
            }

            result.arguments[placeholder] = value;
            result.filters.push(reference + ' ' + operator + ' ' + placeholder);
            return result;
        };

        Query_Renderer.prepare_condition = function (source, condition, ground) {
            var result = {
                filters: [],
                arguments: {},
                property_joins: []
            };
            var value = condition.value, operator = condition.operator || '=';

            var placeholder = ':' + condition.path.join('_') + '_filter' + Query_Renderer.counter++;
            if (Query_Renderer.counter > 10000)
                Query_Renderer.counter = 1;

            var property_chain = Query_Renderer.add_path(condition.path, source.trellis, result);
            var property = property_chain[property_chain.length - 1];
            var reference = Ground.Join.get_end_query(property_chain);

            var operator_action = Ground.Query_Builder.operators[condition.operator];
            if (operator_action && typeof operator_action.render === 'function') {
                var data = {
                    value: value,
                    operator: operator,
                    placeholder: placeholder,
                    reference: reference
                };
                operator_action.render(result, condition, property, data);
                value = data.value;
                placeholder = data.placeholder;
                operator = data.operator;
                reference = data.reference;
            } else {
                if (value === null || (value === 'null' && property.type != 'string')) {
                    if (!operator || operator == '=')
                        operator = 'IS';
                    else if (operator == '!=')
                        operator = 'IS NOT';

                    value = 'NULL';
                } else {
                    if (value !== null)
                        value = ground.convert_value(value, property.type);
                    value = property.get_sql_value(value);
                }
            }

            result.arguments[placeholder] = value;
            result.filters.push(reference + ' ' + operator + ' ' + placeholder);
            return result;
        };

        Query_Renderer.build_filters = function (source, ground) {
            var result = {
                filters: [],
                arguments: {},
                property_joins: []
            };
            for (var i in source.filters) {
                var filter = source.filters[i];
                var additions = Query_Renderer.build_filter(source, filter, ground);

                if (additions.filters.length)
                    result.filters = result.filters.concat(additions.filters);

                if (additions.property_joins.length)
                    result.property_joins = result.property_joins.concat(additions.property_joins);

                if (Object.keys(additions.arguments).length)
                    MetaHub.extend(result.arguments, additions.arguments);
            }
            return result;
        };

        Query_Renderer.process_sorts = function (sorts, trellis, result) {
            if (sorts.length == 0)
                return '';

            var properties = trellis.get_all_properties();

            var items = sorts.map(function (sort) {
                var sql;
                if (sort.path) {
                    var property_chain = Query_Renderer.add_path(sort.path, trellis, result);
                    sql = Ground.Join.get_end_query(property_chain);
                } else {
                    if (!properties[sort.property])
                        throw new Error(trellis.name + ' does not contain sort property: ' + sort.property);

                    sql = properties[sort.property].query();
                }

                if (typeof sort.dir === 'string') {
                    var dir = sort.dir.toUpperCase();
                    if (dir == 'ASC')
                        sql += ' ASC';
                    else if (dir == 'DESC')
                        sql += ' DESC';
                }

                return sql;
            });

            return items.length > 0 ? 'ORDER BY ' + items.join(', ') : '';
        };

        Query_Renderer.render_pager = function (pager) {
            var offset = Math.round(pager.offset);
            var limit = Math.round(pager.limit);
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
        Query_Renderer.counter = 1;
        return Query_Renderer;
    })();
    Ground.Query_Renderer = Query_Renderer;
})(Ground || (Ground = {}));
var Ground;
(function (Ground) {
    var Query_Runner = (function () {
        function Query_Runner(source) {
            this.source = source;
            this.ground = source.ground;
            this.renderer = new Ground.Query_Renderer(this.ground);
        }
        Query_Runner.generate_property_join = function (property, seeds) {
            var join = Ground.Link_Trellis.create_from_property(property);
            return join.generate_join(seeds);
        };

        Query_Runner.create_sub_query = function (trellis, property, source) {
            var query = new Ground.Query_Builder(trellis);
            var original_query = source.subqueries[property.name];
            if (original_query) {
                MetaHub.extend(query.subqueries, original_query.subqueries);
                if (original_query.source)
                    query.extend(original_query.source);
            } else if (typeof source.properties === 'object' && typeof source.properties[property.name] === 'object') {
                query.extend(source.properties[property.name]);
            }
            query.include_links = false;

            return query;
        };

        Query_Runner.get_many_list = function (seed, property, relationship, source) {
            var id = seed[property.parent.primary_key];
            if (id === undefined || id === null)
                throw new Error('Cannot get many-to-many list when seed id is null.');

            var other_property = property.get_other_property();
            if (!other_property)
                throw new Error("Could not find other property for " + property.fullname() + ".");

            var query = Query_Runner.create_sub_query(other_property.parent, property, source);

            query.add_filter(other_property.name, id);
            return query.run();
        };

        Query_Runner.get_path = function () {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 0); _i++) {
                args[_i] = arguments[_i + 0];
            }
            var items = [];

            items = items.concat(args);
            return items.join('/');
        };

        Query_Runner.get_reference_object = function (row, property, source) {
            var query = Query_Runner.create_sub_query(property.other_trellis, property, source);
            var value = row[property.name];
            if (!value)
                return when.resolve(value);

            query.add_key_filter(value);
            return query.run().then(function (result) {
                return result.objects[0];
            });
        };

        Query_Runner.prototype.process_map = function (row, source, links) {
            var _this = this;
            var replacement = undefined;
            var all_properties = source.trellis.get_all_properties();
            var context = {
                properties: row
            };
            for (var i in source.map) {
                var expression = source.map[i];
                var value = Ground.Expression_Engine.resolve(expression, context);
                if (i == 'this') {
                    replacement = value;
                    break;
                }
                if (value !== undefined)
                    row[i] = value;
            }
            MetaHub.map_to_array(links, function (property, name) {
                if (property.is_composite_sub)
                    return null;

                var path = Query_Runner.get_path(property.name);
                var subquery = source.subqueries[property.name];

                if (source.include_links || subquery) {
                    return _this.query_link_property(row, property, source).then(function (value) {
                        row[name] = value;
                        return row;
                    });
                }

                return null;
            });

            return replacement;
        };

        Query_Runner.prototype.process_row_step_one = function (row, source) {
            var _this = this;
            var type_property = source.trellis.type_property;

            var trellis = type_property && row[type_property.name] ? this.ground.sanitize_trellis_argument(row[type_property.name]) : source.trellis;

            if (trellis != source.trellis) {
                var query = new Ground.Query_Builder(trellis);
                query.add_key_filter(trellis.get_identity2(row));
                if (source.properties)
                    query.properties = source.properties;
                if (source.map)
                    query.map = source.map;

                return query.run_single().then(function (row) {
                    return _this.process_row_step_two(row, source, trellis);
                });
            } else {
                return this.process_row_step_two(row, source, trellis);
            }
        };

        Query_Runner.prototype.process_row_step_two = function (row, source, trellis) {
            var _this = this;
            var name, property, replacement = undefined;

            var properties = trellis.get_core_properties();
            for (name in properties) {
                property = properties[name];
                var value = row[property.name];
                if (value === undefined)
                    continue;

                row[property.name] = this.ground.convert_value(value, property.type);
            }

            var links = trellis.get_all_links(function (p) {
                return !p.is_virtual;
            });

            var tree = trellis.get_tree().filter(function (t) {
                return !t.is_virtual;
            });
            var promises = MetaHub.map_to_array(links, function (property, name) {
                if (property.is_composite_sub)
                    return null;

                var path = Query_Runner.get_path(property.name);
                var subquery = source.subqueries[property.name];

                if (source.include_links || subquery) {
                    return _this.query_link_property(row, property, source).then(function (value) {
                        row[name] = value;
                        return row;
                    });
                }

                return null;
            }).concat(tree.map(function (trellis) {
                return function () {
                    return _this.ground.invoke(trellis.name + '.queried', row, _this);
                };
            }));

            if (typeof source.map === 'object') {
                replacement = this.process_map(row, source, links);
            }

            return when.all(promises).then(function () {
                return replacement === undefined ? row : replacement;
            });
        };

        Query_Runner.prototype.query_link_property = function (seed, property, source) {
            var relationship = property.get_relationship();

            switch (relationship) {
                case 1 /* one_to_one */:
                    return Query_Runner.get_reference_object(seed, property, source);
                    break;
                case 2 /* one_to_many */:
                case 3 /* many_to_many */:
                    return Query_Runner.get_many_list(seed, property, relationship, source).then(function (result) {
                        return result ? result.objects : [];
                    });
                    break;
            }

            throw new Error('Could not find relationship: ' + relationship + '.');
        };

        Query_Runner.prototype.prepare = function () {
            var _this = this;
            var source = this.source;
            if (this.row_cache)
                return when.resolve(this.row_cache);

            var tree = source.trellis.get_tree();
            var promises = tree.map(function (trellis) {
                return function () {
                    return _this.ground.invoke(trellis.name + '.query', source);
                };
            });
            promises = promises.concat(function () {
                return _this.ground.invoke('*.query', source);
            });

            var is_empty = false;

            if (source.filters) {
                for (var i in source.filters) {
                    var filter = source.filters[i];
                    var operator_action = Ground.Query_Builder.operators[filter.operator];
                    if (operator_action && typeof operator_action.prepare === 'function') {
                        if (filter.property) {
                            var property = source.trellis.sanitize_property(filter.property);
                            promises.push(function () {
                                return operator_action.prepare(filter, property).then(function (result) {
                                    if (result === false)
                                        is_empty = true;
                                });
                            });
                        }
                    }
                }
            }

            var queries = [];

            if (source.type == 'union') {
                var query_index = 0;
                promises = promises.concat(source.queries.map(function (query) {
                    return function () {
                        var runner = new Query_Runner(query);
                        return runner.render(query_index++).then(function (result) {
                            queries.push(result.sql);
                            return when.resolve();
                        });
                    };
                }));
            }

            var sequence = require('when/sequence');
            return sequence(promises).then(function () {
                return {
                    queries: queries,
                    is_empty: is_empty
                };
            });
        };

        Query_Runner.prototype.render = function (query_id) {
            if (typeof query_id === "undefined") { query_id = undefined; }
            var _this = this;
            return this.prepare().then(function (preparation) {
                if (preparation.is_empty)
                    return when.resolve(null);

                var source = _this.source;
                var parts = _this.renderer.generate_parts(source, query_id);
                var sql = source.type == 'union' ? _this.renderer.generate_union(parts, preparation.queries, source) : _this.renderer.generate_sql(parts, source);

                sql = sql.replace(/\r/g, "\n");
                if (_this.ground.log_queries)
                    console.log('\nquery', sql + '\n');

                return {
                    sql: sql,
                    parts: parts,
                    preparation: preparation
                };
            });
        };

        Query_Runner.prototype.run_core = function () {
            var _this = this;
            return this.render().then(function (render_result) {
                if (!render_result.sql)
                    return when.resolve([]);

                return _this.ground.db.query(render_result.sql).then(function (rows) {
                    var result = {
                        objects: rows
                    };
                    _this.row_cache = result;
                    if (_this.source.pager) {
                        var sql = _this.source.type != 'union' ? _this.renderer.generate_count(render_result.parts) : _this.renderer.generate_union_count(render_result.parts, render_result.preparation.queries, _this.source);

                        if (_this.ground.log_queries)
                            console.log('\nquery', sql + '\n');
                        return _this.ground.db.query_single(sql).then(function (count) {
                            result['total'] = count.total_number;
                            return result;
                        });
                    } else {
                        return when.resolve(result);
                    }
                });
            });
        };

        Query_Runner.prototype.get_source = function (row) {
            if (this.source.type !== 'union')
                return this.source;

            return this.source.queries[row._query_id_];
        };

        Query_Runner.prototype.run = function () {
            var _this = this;
            if (this.ground.log_queries) {
                var temp = new Error();
                this.run_stack = temp['stack'];
            }

            return this.run_core().then(function (result) {
                return when.all(result.objects.map(function (row) {
                    return _this.process_row_step_one(row, _this.get_source(row));
                })).then(function (rows) {
                    result.objects = rows;
                    return result;
                });
            });
        };

        Query_Runner.prototype.run_single = function () {
            return this.run().then(function (result) {
                return result.objects[0];
            });
        };
        return Query_Runner;
    })();
    Ground.Query_Runner = Query_Runner;
})(Ground || (Ground = {}));
require('source-map-support').install();
//# sourceMappingURL=ground.js.map
