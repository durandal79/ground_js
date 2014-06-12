/// <reference path="../references.ts"/>
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
            if (relationship === 3 /* many_to_many */) {
                //        var seeds = {}
                //        seeds[source.trellis.name] = seed
                query.filters.push(Ground.Query_Builder.create_join_filter(property, seed));
                //        query.add_join(Query_Runner.generate_property_join(property, seeds))
            } else if (relationship === 2 /* one_to_many */)
                query.add_filter(other_property.name, id);

            return query.run();
        };

        Query_Runner.get_path = function () {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 0); _i++) {
                args[_i] = arguments[_i + 0];
            }
            var items = [];

            //      if (this.base_path)
            //        items.push(this.base_path);
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
                case 1 /* one_to_one */:
                    return Query_Runner.get_reference_object(seed, property, source);
                    break;
                case 2 /* one_to_many */:
                case 3 /* many_to_many */:
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
            promises = promises.concat(this.ground.invoke('*.query', source));

            return when.all(promises).then(function () {
                var sql = _this.renderer.generate_sql(source);
                sql = sql.replace(/\r/g, "\n");
                if (_this.ground.log_queries)
                    console.log('\nquery', sql + '\n');

                //          var args = MetaHub.values(this.arguments).concat(args);
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
//# sourceMappingURL=Query_Runner.js.map
