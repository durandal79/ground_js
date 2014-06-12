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
            //      this.filters.push(this.trellis.query_primary_key() + ' = :primary_key');
            //      this.add_arguments({ ':primary_key': value });
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

                //        sql = sql.replace(new RegExp(pattern), Property.get_sql_value(value));
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

                // Virtual properties aren't saved to the database
                // Useful when you define custom serialization hooks
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

                // Check if the expansion is a regex
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
            if (value === 'null' && property.type != 'string') {
                result.filters.push(property.query() + ' IS NULL');
                return result;
            }

            if (value !== null)
                value = this.ground.convert_value(value, property.type);

            if (value === null || value === undefined) {
                throw new Error('Query property filter ' + placeholder + ' is null.');
            }

            if (property.get_relationship() == 3 /* many_to_many */) {
                //        throw new Error('Filtering many to many will need to be rewritten for the new Link_Trellis.');
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

                //          var args = MetaHub.values(this.arguments).concat(args);
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

        // The cross_property parameter is intended to override the normal trellis with a cross-table;
        // useful for optimizing joins.
        Query.get_identity_sql = function (property, cross_property) {
            if (typeof cross_property === "undefined") { cross_property = null; }
            if (cross_property) {
                var join = Ground.Link_Trellis.create_from_property(cross_property);
                var identity = join.get_identity_by_trellis(cross_property.other_trellis);
                return join.table_name + '.' + identity.name;
            } else if (property.type == 'list') {
                var trellis = property.parent;

                //          return trellis.properties[trellis.primary_key].query()
                return trellis.query_primary_key();
            } else {
                return property.query();
            }
        };

        // The cross_property parameter is intended to override the normal trellis with a cross-table;
        // useful for optimizing joins.
        Query.generate_join = function (property, cross_property) {
            if (typeof cross_property === "undefined") { cross_property = null; }
            var other_property = property.get_other_property(true);

            //      if (!other_property)
            //        throw new Error('Could not find other property of ' + property.query())
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

                    //          seeds[this.trellis.name] = seed
                    var join = Ground.Link_Trellis.create_from_property(property);
                    var identity = join.get_identity_by_trellis(property.parent);
                    return 'JOIN ' + join.table_name + '\nON ' + join.get_identity_conditions(identity, {}, true).join(' AND ') + '\n';
            }
        };

        Query.query_path = function (path, args, ground) {
            var sql = Query.follow_path(path, args, ground);

            //      console.log('query_path', sql)
            return ground.db.query_single(sql);
        };

        // Returns a sql query string
        Query.follow_path = function (path, args, ground) {
            var parts = Ground.path_to_array(path);
            var sql = 'SELECT COUNT(*) AS total\n';

            //      var parts = Query.process_tokens(tokens, args, ground)
            var cross_property = null, first_trellis;

            var trellis = first_trellis = ground.sanitize_trellis_argument(parts[0]);
            sql += 'FROM `' + trellis.get_plural() + '`\n';

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
                //        sql += ' AND ' + trellis.query_primary_key() + ' = '
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
//# sourceMappingURL=Query.js.map
