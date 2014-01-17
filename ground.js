var MetaHub = require('metahub');var when = require('when');

var Ground;
(function (Ground) {
    var Database = (function () {
        function Database(settings, database) {
            this.log_queries = false;
            this.settings = settings;
            this.database = database;
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
            var connection, def = when.defer();
            var mysql = require('mysql');
            connection = mysql.createConnection(this.settings[this.database]);
            connection.connect();
            if (this.log_queries)
                console.log('start', sql);

            connection.query(sql, args, function (err, rows, fields) {
                if (err) {
                    console.log('error', sql);
                    throw err;
                }

                def.resolve(rows, fields);

                return null;
            });
            connection.end();

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
            this.plural = null;
            this.parent = null;
            this.table = null;
            this.name = null;
            this.primary_key = 'id';
            this.properties = {};
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

        Trellis.prototype.get_plural = function () {
            return this.plural || this.name + 's';
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

        Trellis.prototype.query_primary_key = function () {
            return this.get_table_query() + '.' + this.properties[this.primary_key].get_field_name();
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
            if (relationship === Ground.Relationships.many_to_many) {
                var seeds = {};
                seeds[this.trellis.name] = seed;
                query.add_join(Query.generate_property_join(property, seeds));
            } else if (relationship === Ground.Relationships.one_to_many)
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
                case Ground.Relationships.one_to_one:
                    return this.get_reference_object(seed, property);
                    break;
                case Ground.Relationships.one_to_many:
                case Ground.Relationships.many_to_many:
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
            if (value === 'null' && property.type != 'string') {
                result.filters.push(property.query() + ' IS NULL');
                return result;
            }

            if (value !== null)
                value = this.ground.convert_value(value, property.type);

            if (value === null || value === undefined) {
                throw new Error('Query property filter ' + placeholder + ' is null.');
            }

            if (property.get_relationship() == Ground.Relationships.many_to_many) {
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
                case Ground.Relationships.one_to_one:
                case Ground.Relationships.one_to_many:
                    var first_part, second_part;
                    if (property.type == 'list')
                        first_part = other_property.query();
else
                        first_part = other.query_primary_key();

                    second_part = Query.get_identity_sql(property, cross_property);

                    return 'JOIN ' + other.get_table_query() + '\nON ' + first_part + ' = ' + second_part + '\n';

                case Ground.Relationships.many_to_many:
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
            sql += 'FROM `' + trellis.get_plural() + '`\n';

            for (var i = 1; i < parts.length; ++i) {
                var properties = trellis.get_all_properties();
                var property = properties[parts[i]];
                if (!property)
                    throw new Error('Could not find ' + trellis.name + '.' + parts[i] + '.');

                sql += Query.generate_join(property, cross_property);
                cross_property = property.get_relationship() == Ground.Relationships.many_to_many ? property : null;
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
            return this.ground.update_object(property.other_trellis, value, this.user).then(function (entity) {
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
                    if (_this.seed[property.name] !== undefined) {
                        var field_string = '`' + property.get_field_name() + '`';
                        var value = _this.get_field_value(property, _this.seed);
                        updates.push(field_string + ' = ' + value);
                    }
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
                    case Ground.Relationships.one_to_many:
                        promises.push(this.update_one_to_many(property));
                        break;
                    case Ground.Relationships.many_to_many:
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
                    if (typeof other === 'object' && other._remove) {
                        if (other_id !== null) {
                            sql = join.generate_delete_row([row, other]);
                            if (_this.log_queries)
                                console.log(sql);

                            return _this.ground.invoke(join.table_name + '.delete', property, row, other, join).then(function () {
                                return _this.db.query(sql);
                            });
                        }
                    } else {
                        if (other_id === null) {
                            other = _this.ground.update_object(other_trellis, other, _this.user).then(function (other) {
                                var seeds = {};
                                seeds[_this.trellis.name] = row;
                                seeds[other_trellis.name] = other;
                                sql = join.generate_insert(seeds);
                                if (_this.log_queries)
                                    console.log(sql);

                                return _this.db.query(sql).then(function () {
                                    return _this.ground.invoke(join.table_name + '.create', property, row, other, join);
                                });
                            });
                        } else {
                            var seeds = {};
                            seeds[_this.trellis.name] = row;
                            seeds[other_trellis.name] = other;
                            sql = join.generate_insert(seeds);
                            if (_this.log_queries)
                                console.log(sql);

                            return _this.db.query(sql).then(function () {
                                return _this.ground.invoke(join.table_name + '.create', property, row, other, join);
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
            if (typeof other !== 'object')
                return when.resolve();

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
            if (this.log_queries) {
                var temp = new Error();
                this.run_stack = temp['stack'];
            }

            var tree = this.trellis.get_tree().filter(function (t) {
                return !t.is_virtual;
            });
            var invoke_promises = tree.map(function (trellis) {
                return _this.ground.invoke(trellis.name + '.update', _this.seed, _this);
            });

            invoke_promises = invoke_promises.concat(this.ground.invoke('*.update', this.seed, this));

            return when.all(invoke_promises).then(function () {
                var promises = tree.map(function (trellis) {
                    return _this.generate_sql(trellis);
                });
                return when.all(promises).then(function () {
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
        function Delete(trellis, seed) {
            this.trellis = trellis;
            this.seed = seed;
        }
        Delete.prototype.get_access_name = function () {
            return this.trellis + '.delete';
        };

        Delete.prototype.run = function () {
            throw new Error('Not implemented yet.');
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

            if (seed._deleted === true || seed._deleted === 'true')
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
var Ground;
(function (Ground) {
    var Table = (function () {
        function Table(name, ground) {
            this.properties = {};
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
                if (property.is_virtual)
                    continue;

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

            var primary_keys = this.get_primary_keys(trellis);

            return Table.create_sql_from_array(this.name, fields, primary_keys, this.indexes);
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
var Ground;
(function (Ground) {
    var Link_Trellis = (function () {
        function Link_Trellis(trellises) {
            var _this = this;
            this.trellises = [];
            this.trellis_dictionary = {};
            this.trellises = trellises;

            for (var i = 0; i < trellises.length; ++i) {
                var trellis = trellises[i];
                this.trellis_dictionary[trellis.name] = trellis;
            }

            this.table_name = trellises.map(function (t) {
                return t.get_plural();
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
            var trellises = [
                property.parent,
                property.other_trellis
            ];
            return new Link_Trellis(trellises);
        };

        Link_Trellis.create_reference = function (property, name) {
            return {
                name: name,
                type: property.type,
                property: property
            };
        };

        Link_Trellis.prototype.generate_join = function (seeds) {
            return 'JOIN ' + this.table_name + ' ON ' + this.get_condition_string(seeds) + "\n";
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
                return p.parent.get_plural();
            });
            temp = temp.sort();
            this.table_name = temp.join('_');
        };

        Link_Trellis.prototype.get_key_condition = function (key, seed, fill_blanks) {
            if (typeof fill_blanks === "undefined") { fill_blanks = false; }
            if (!seed) {
                console.log('empty key');
            }
            if (typeof seed === 'string')
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
            var conditions = [];
            for (var i in this.identities) {
                var identity = this.identities[i], seed = seeds[identity.trellis.name];
                if (!seed) {
                    var other_identity = this.identities[1 - i];
                    for (var p in identity.keys) {
                        var key = identity.keys[p], other_key = other_identity.keys[p];
                        conditions.push(this.table_name + '.' + key.name + ' = `' + identity.trellis.get_table_name() + '`.' + key.property.name);
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
        return Link_Trellis;
    })();
    Ground.Link_Trellis = Link_Trellis;
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
                return Relationships.none;

            var field = this.get_field_override();
            if (field && field.relationship) {
                return Relationships[field.relationship];
            }

            var other_property = this.get_other_property();
            if (!other_property) {
                if (this.type == 'list')
                    return Relationships.one_to_many;
else
                    return Relationships.one_to_one;
            }

            if (this.type == 'list') {
                if (other_property.type == 'list')
                    return Relationships.many_to_many;
else
                    return Relationships.one_to_many;
            }
            return Relationships.one_to_one;
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
var Ground;
(function (Ground) {
    var Query_Builder = (function () {
        function Query_Builder(trellis) {
            this.type = 'query';
            this.sorts = [];
            this.include_links = true;
            this.transforms = [];
            this.subqueries = {};
            this.filters = [];
            this.trellis = trellis;
            this.ground = trellis.ground;
        }
        Query_Builder.prototype.add_filter = function (property_name, value, operator) {
            if (typeof value === "undefined") { value = null; }
            if (typeof operator === "undefined") { operator = '='; }
            var properties = this.trellis.get_all_properties();
            var property = properties[property_name];
            if (!property)
                throw new Error('Trellis ' + this.trellis.name + ' does not contain a property named ' + property_name + '.');

            if (Ground.Query.operators.indexOf(operator) === -1)
                throw new Error("Invalid operator: '" + operator + "'.");

            if (value === null || value === undefined)
                throw new Error('Cannot add property filter where value is null; property = ' + this.trellis.name + '.' + property_name + '.');

            this.filters.push({
                property: property,
                value: value,
                operator: operator
            });
        };

        Query_Builder.prototype.add_key_filter = function (value) {
            this.add_filter(this.trellis.primary_key, value);
        };

        Query_Builder.prototype.add_sort = function (sort) {
            for (var i = 0; i < this.sorts.length; ++i) {
                if (this.sorts[i].property == sort.property) {
                    this.sorts.splice(i, 1);
                    break;
                }
            }

            this.sorts.push(sort);
        };

        Query_Builder.prototype.add_subquery = function (property_name, source) {
            if (typeof source === "undefined") { source = null; }
            var properties = this.trellis.get_all_properties();
            var property = properties[property_name];
            if (!property)
                throw new Error('Cannot create subquery. ' + this.trellis.name + ' does not have a property named ' + property_name + '.');

            if (!property.other_trellis)
                throw new Error('Cannot create a subquery from ' + property.fullname() + ' it does not reference another trellis.');

            var query = new Query_Builder(property.other_trellis);
            query.include_links = false;
            query.extend(source);
            this.subqueries[property_name] = query;
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

            return {
                property: property.get_other_property(true),
                value: value,
                operator: '='
            };
        };

        Query_Builder.prototype.extend = function (source) {
            if (!source)
                return;

            var i;
            this.source = source;

            if (source.filters) {
                for (i = 0; i < source.filters.length; ++i) {
                    var filter = source.filters[i];
                    this.add_filter(filter.path || filter.property, filter.value, filter.operator);
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

            if (typeof source.subqueries == 'object') {
                for (i in source.subqueries) {
                    this.add_subquery(i, source.subqueries[i]);
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
                return filter.property.name == _this.trellis.primary_key;
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
            return this.run().then(function (rows) {
                return rows[0];
            });
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

        Query_Renderer.prototype.generate_sql = function (source) {
            var properties = Query_Renderer.get_properties(source);
            var data = Query_Renderer.get_fields_and_joins(source, properties);
            var data2 = Query_Renderer.process_property_filters(source, this.ground);
            var fields = data.fields;
            var joins = data.joins.concat(data2.joins);
            var args = data2.arguments;
            var filters = data2.filters || [];

            if (fields.length == 0)
                throw new Error('No authorized fields found for trellis ' + source.trellis.name + '.');

            var sql = 'SELECT ';
            sql += fields.join(",\n");
            sql += "\nFROM `" + source.trellis.get_table_name() + '`';
            if (joins.length > 0)
                sql += "\n" + joins.join("\n");

            if (filters.length > 0)
                sql += "\nWHERE " + filters.join(" AND ");

            if (source.sorts.length > 0)
                sql += ' ' + Query_Renderer.process_sorts(source.sorts, source.trellis);

            for (var i = 0; i < source.transforms.length; ++i) {
                var transform = source.transforms[i];
                var temp_table = 'transform_' + (i + 1);
                sql = 'SELECT * FROM (' + sql + ' ) ' + temp_table + ' ' + transform.clause;
            }

            for (var pattern in args) {
                var value = args[pattern];

                sql = sql.replace(new RegExp(pattern, 'g'), value);
            }

            return sql;
        };

        Query_Renderer.get_fields_and_joins = function (source, properties, include_primary_key) {
            if (typeof include_primary_key === "undefined") { include_primary_key = true; }
            var name, fields = [];
            var trellises = {};
            for (name in properties) {
                var property = properties[name];

                if (property.type == 'list' || property.is_virtual)
                    continue;

                if (property.name != source.trellis.primary_key || include_primary_key) {
                    var sql = property.get_field_query();
                    fields.push(sql);
                    if (property.parent.name != source.trellis.name)
                        trellises[property.parent.name] = property.parent;
                }
            }
            var joins = [];
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

        Query_Renderer.process_property_filter = function (source, filter, ground) {
            var result = {
                filters: [],
                arguments: {},
                joins: []
            };
            var property = source.trellis.sanitize_property(filter.property);
            var value = filter.value;

            var placeholder = ':' + property.name + '_filter' + Query_Renderer.counter++;
            if (Query_Renderer.counter > 10000)
                Query_Renderer.counter = 1;

            if (value === 'null' && property.type != 'string') {
                result.filters.push(property.query() + ' IS NULL');
                return result;
            }

            if (value !== null)
                value = ground.convert_value(value, property.type);

            if (value === null || value === undefined) {
                throw new Error('Query property filter ' + placeholder + ' is null.');
            }

            if (property.get_relationship() == Ground.Relationships.many_to_many) {
                var join_seed = {}, s = {};
                s[property.other_trellis.primary_key] = placeholder;
                join_seed[property.other_trellis.name] = s;

                result.joins.push(Query_Renderer.generate_property_join(property, join_seed));
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

        Query_Renderer.process_property_filters = function (source, ground) {
            var result = {};
            for (var i in source.filters) {
                var filter = source.filters[i];
                MetaHub.extend(result, Query_Renderer.process_property_filter(source, filter, ground));
            }
            return result;
        };

        Query_Renderer.process_sorts = function (sorts, trellis) {
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
            var query = source.subqueries[property.name];

            if (!query) {
                query = new Ground.Query_Builder(trellis);
                query.include_links = false;
                if (typeof source.properties === 'object' && typeof source.properties[property.name] === 'object') {
                    query.extend(source.properties[property.name]);
                }
            }

            return query;
        };

        Query_Runner.get_many_list = function (seed, property, relationship, source) {
            var id = seed[property.parent.primary_key];
            if (id === undefined || id === null)
                throw new Error('Cannot get many-to-many list when seed id is null.');

            var other_property = property.get_other_property();
            if (!other_property)
                return when.resolve();

            var query = Query_Runner.create_sub_query(other_property.parent, property, source);
            if (relationship === Ground.Relationships.many_to_many) {
                query.filters.push(Ground.Query_Builder.create_join_filter(property, seed));
            } else if (relationship === Ground.Relationships.one_to_many)
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
            return query.run().then(function (rows) {
                return rows[0];
            });
        };

        Query_Runner.prototype.process_row = function (row, source) {
            var _this = this;
            var name, property;

            var properties = source.trellis.get_core_properties();
            for (name in properties) {
                property = properties[name];
                var value = row[property.name];
                if (value === undefined)
                    continue;

                row[property.name] = this.ground.convert_value(value, property.type);
            }

            var links = source.trellis.get_all_links(function (p) {
                return !p.is_virtual;
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
            });

            return when.all(promises).then(function () {
                return _this.ground.invoke(source.trellis.name + '.queried', row, _this);
            }).then(function () {
                return row;
            });
        };

        Query_Runner.prototype.query_link_property = function (seed, property, source) {
            var relationship = property.get_relationship();

            switch (relationship) {
                case Ground.Relationships.one_to_one:
                    return Query_Runner.get_reference_object(seed, property, source);
                    break;
                case Ground.Relationships.one_to_many:
                case Ground.Relationships.many_to_many:
                    return Query_Runner.get_many_list(seed, property, relationship, source);
                    break;
            }

            throw new Error('Could not find relationship: ' + relationship + '.');
        };

        Query_Runner.prototype.run_core = function () {
            var _this = this;
            var source = this.source;
            if (this.row_cache)
                return when.resolve(this.row_cache);

            var tree = source.trellis.get_tree();
            var promises = tree.map(function (trellis) {
                return _this.ground.invoke(trellis.name + '.query', source);
            });

            return when.all(promises).then(function () {
                var sql = _this.renderer.generate_sql(source);
                sql = sql.replace(/\r/g, "\n");
                if (_this.ground.log_queries)
                    console.log('\nquery', sql + '\n');

                return _this.ground.db.query(sql).then(function (rows) {
                    _this.row_cache = rows;
                    return rows;
                });
            });
        };

        Query_Runner.prototype.run = function () {
            var _this = this;
            var source = this.source;
            if (this.ground.log_queries) {
                var temp = new Error();
                this.run_stack = temp['stack'];
            }

            var properties = source.trellis.get_all_properties();
            return this.run_core().then(function (rows) {
                return when.all(rows.map(function (row) {
                    return _this.process_row(row, source);
                }));
            });
        };

        Query_Runner.prototype.run_single = function () {
            return this.run().then(function (rows) {
                return rows[0];
            });
        };
        return Query_Runner;
    })();
    Ground.Query_Runner = Query_Runner;
})(Ground || (Ground = {}));
require('source-map-support').install();
//# sourceMappingURL=ground.js.map
