/// <reference path="../references.ts"/>
var Ground;
(function (Ground) {
    var Query_Builder = (function () {
        function Query_Builder(trellis) {
            this.type = 'query';
            //    source:External_Query_Source
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
//# sourceMappingURL=Query_Builder.js.map
