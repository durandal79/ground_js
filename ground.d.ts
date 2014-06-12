
/// <reference path="../vineyard-metahub/metahub.d.ts" />

declare var when: any;
declare var mysql: any;
declare module Ground {
    class Database {
        public settings: any;
        public database: string;
        public log_queries: boolean;
        public pool: any;
        public active: boolean;
        constructor(settings: {}, database: string);
        public add_table_to_database(table: Ground.Table, ground: Ground.Core): Promise;
        public add_non_trellis_tables_to_database(tables: Ground.Table[], ground: Ground.Core): Promise;
        public start(): void;
        public close(): void;
        public create_table(trellis: Ground.Trellis): Promise;
        public create_trellis_tables(trellises: Ground.Trellis[]): Promise;
        public drop_all_tables(): Promise;
        public get_tables(): Promise;
        public query(sql: string, args?: any[]): Promise;
        public query_single(sql: string, args?: any[]): Promise;
    }
}
declare module Ground {
    interface ITrellis {
    }
    class Trellis implements ITrellis {
        public parent: Trellis;
        public ground: Ground.Core;
        public table: Ground.Table;
        public name: string;
        public primary_key: string;
        public is_virtual: boolean;
        public properties: {
            [name: string]: Ground.Property;
        };
        public all_properties: {};
        public type_property: Ground.Property;
        constructor(name: string, ground: Ground.Core);
        public add_property(name: string, source: any): Ground.Property;
        public check_primary_key(): void;
        public clone_property(property_name: string, target_trellis: Trellis): void;
        public get_all_links(filter?: (property: Ground.Property) => boolean): {};
        public get_all_properties(): {};
        public get_property(name: string): Ground.Property;
        public get_core_properties(): {};
        public get_id(source: any): any;
        public get_identity(seed: any): {};
        public get_identity2(value: any): any;
        public get_ancestor_join(other: Trellis): string;
        public get_links(): Ground.Property[];
        public get_primary_keys(): any[];
        public get_primary_property(): Ground.Property;
        public get_reference_property(other_trellis: Trellis): Ground.Property;
        public get_root_table(): Ground.Table;
        public get_table_name(): string;
        public get_table_query(): string;
        public get_tree(): Trellis[];
        public initialize(all: any): void;
        public load_from_object(source: Ground.ITrellis_Source): void;
        public query(): string;
        public query_primary_key(): string;
        public sanitize_property(property: any): any;
        public set_parent(parent: Trellis): void;
        private seed_has_properties(seed, properties);
        public assure_properties(seed: any, required_properties: string[]): Promise;
        public export_schema(): Ground.ITrellis_Source;
    }
}
declare module Ground {
    interface IService_Response {
        objects: any[];
    }
    interface Query_Wrapper {
        start: string;
        end: string;
    }
    interface Property_Query_Source {
        name: string;
        filters?: Ground.Query_Filter_Source[];
        sorts?: Ground.Query_Sort[];
        expansions?: string[];
        properties?: any[];
        subqueries?: any;
        pager?: any;
    }
    interface External_Query_Source extends Property_Query_Source {
        trellis: string;
        map?: any;
        type?: string;
        queries?: External_Query_Source[];
    }
    class Query {
        public ground: Ground.Core;
        public joins: string[];
        public post_clauses: any[];
        public limit: string;
        public trellis: Ground.Trellis;
        public db: Ground.Database;
        public include_links: boolean;
        public fields: string[];
        public base_path: string;
        public arguments: {};
        public expansions: string[];
        public wrappers: Query_Wrapper[];
        private row_cache;
        public type: string;
        public properties: any;
        public source: External_Query_Source;
        public sorts: Ground.Query_Sort[];
        public filters: string[];
        public run_stack: any;
        public property_filters: Ground.Query_Filter_Source[];
        static operators: string[];
        private links;
        constructor(trellis: Ground.Trellis, base_path?: string);
        public add_arguments(args: any): void;
        public add_filter(clause: string, arguments?: any[]): void;
        public add_property_filter(property: string, value?: any, operator?: string): void;
        public add_key_filter(value: any): void;
        public add_field(clause: string, arguments?: any): void;
        public add_join(clause: string, arguments?: any): void;
        public add_post(clause: string, arguments?: any): void;
        public add_expansion(clause: any): void;
        public add_link(property: any): void;
        public add_sort(sort: Ground.Query_Sort): void;
        static process_sorts(sorts: Ground.Query_Sort[], trellis: Ground.Trellis): string;
        public add_wrapper(wrapper: Query_Wrapper): void;
        public generate_pager(offset?: number, limit?: number): string;
        public generate_sql(properties: any): string;
        public get_fields_and_joins(properties: {
            [name: string]: Ground.Property;
        }, include_primary_key?: boolean): Ground.Internal_Query_Source;
        public get_primary_key_value(): any;
        static generate_property_join(property: Ground.Property, seeds: any): string;
        public create_sub_query(trellis: Ground.Trellis, property: Ground.Property): Query;
        public get_many_list(seed: any, property: Ground.Property, relationship: Ground.Relationships): Promise;
        public get_path(...args: string[]): string;
        public get_reference_object(row: any, property: Ground.Property): any;
        public has_expansion(path: string): boolean;
        public process_row(row: any): Promise;
        public query_link_property(seed: any, property: any): Promise;
        public process_property_filter(filter: any): Ground.Internal_Query_Source;
        public process_property_filters(): Ground.Internal_Query_Source;
        public extend(source: External_Query_Source): void;
        public run_core(): Promise;
        public run(): Promise;
        static get_identity_sql(property: Ground.Property, cross_property?: Ground.Property): string;
        static generate_join(property: Ground.Property, cross_property?: Ground.Property): string;
        static query_path(path: string, args: any[], ground: Ground.Core): Promise;
        static follow_path(path: any, args: any[], ground: Ground.Core): string;
        private static process_tokens(tokens, args, ground);
    }
}
declare var uuid: any;
declare module Ground {
    interface IUser {
        id: any;
    }
    class Update implements Ground.IUpdate {
        public seed: Ground.ISeed;
        private fields;
        public override: boolean;
        public trellis: Ground.Trellis;
        public main_table: string;
        public ground: Ground.Core;
        public db: Ground.Database;
        public user: IUser;
        public log_queries: boolean;
        public run_stack: any;
        constructor(trellis: Ground.Trellis, seed: Ground.ISeed, ground?: Ground.Core);
        public get_access_name(): string;
        private generate_sql(trellis);
        private update_embedded_seed(property, value);
        private update_embedded_seeds(core_properties);
        private create_record(trellis);
        private update_record(trellis, id, key_condition);
        private apply_insert(property, value);
        public is_create_property(property: Ground.Property): boolean;
        private get_field_value(property, seed);
        private is_update_property(property);
        private update_links(trellis, id, create?);
        private update_many_to_many(property, create?);
        private update_one_to_many(property);
        private update_reference(property, id);
        private update_reference_object(other, property);
        public run(): Promise;
    }
}
declare module Ground {
    class Delete implements Ground.IUpdate {
        public ground: Ground.Core;
        public trellis: Ground.Trellis;
        public seed: any;
        public max_depth: number;
        constructor(ground: Ground.Core, trellis: Ground.Trellis, seed: Ground.ISeed);
        public get_access_name(): string;
        private delete_child(link, id, depth?);
        private delete_children(trellis, id, depth?);
        public delete_record(trellis: Ground.Trellis, id: any): Promise;
        private get_child_links(trellis);
        public run(depth?: number): Promise;
        private run_delete(trellis, seed, depth?);
    }
}
declare module Ground {
    interface IProperty_Source {
        name?: string;
        type: string;
        insert?: string;
        is_virtual?: boolean;
        is_readonly?: boolean;
        is_private?: boolean;
        property?: string;
        trellis?: string;
        allow_null?: boolean;
    }
    interface ITrellis_Source {
        parent?: string;
        name?: string;
        primary_key?: string;
        properties?: any;
        is_virtual?: boolean;
    }
    interface ISeed {
        _deleted?: any;
        _deleted_?: any;
        _removed_?: any;
    }
    interface IUpdate {
        run: () => Promise;
        get_access_name(): string;
    }
    interface ISchema_Source {
        trellises?: any;
        tables?: any;
        views?: any;
        logic?: any;
    }
    function path_to_array(path: any): any;
    class Property_Type {
        public name: string;
        public property_class: any;
        public field_type: any;
        public default_value: any;
        public parent: Property_Type;
        public db: Ground.Database;
        public allow_null: boolean;
        constructor(name: string, info: any, types: Property_Type[]);
        public get_field_type(): any;
    }
    class Core extends MetaHub.Meta_Object {
        public trellises: Ground.Trellis[];
        public custom_tables: Ground.Table[];
        public tables: Ground.Table[];
        public views: any[];
        public property_types: Property_Type[];
        public db: Ground.Database;
        public log_queries: boolean;
        public log_updates: boolean;
        constructor(config: any, db_name: string);
        public add_trellis(name: string, source: ITrellis_Source, initialize_parent?: boolean): Ground.Trellis;
        public get_base_property_type(type: any): any;
        public convert_value(value: any, type: any): any;
        private create_remaining_tables();
        private create_missing_table_links();
        public create_query(trellis_name: string, base_path?: string): Ground.Query_Builder;
        public create_update(trellis: any, seed?: ISeed, user?: Ground.IUser): IUpdate;
        public delete_object(trellis: Ground.Trellis, seed: ISeed): Promise;
        public initialize_trellises(subset: Ground.Trellis[], all?: any): void;
        public insert_object(trellis: any, seed?: ISeed, user?: Ground.IUser, as_service?: boolean): Promise;
        static is_private(property: Ground.Property): boolean;
        static is_private_or_readonly(property: Ground.Property): boolean;
        public update_object(trellis: any, seed?: ISeed, user?: Ground.IUser, as_service?: boolean): Promise;
        static load_json_from_file(filename: string): any;
        public load_property_types(filename: string): void;
        public load_schema_from_file(filename: string): void;
        public load_tables(tables: any[]): void;
        public load_trellises(trellises: ITrellis_Source[]): Ground.Trellis[];
        private parse_schema(data);
        static remove_fields(object: any, trellis: Ground.Trellis, filter: any): any;
        public sanitize_trellis_argument(trellis: any): Ground.Trellis;
        public stop(): void;
        static to_bool(input: any): boolean;
        public export_schema(): ISchema_Source;
    }
}
declare module Ground {
    interface IField {
        relationship?: string;
        name: string;
        share?: string;
        other_table?: string;
        other_field?: string;
    }
    enum Link_Field_Type {
        identity = 0,
        reference = 1,
    }
    class Link_Field {
        public name: string;
        public parent: Table;
        public other_table: Table;
        public type: Link_Field_Type;
        public other_link: Link_Field;
        public field: IField;
        public property: Ground.Property;
        constructor(name: string, parent: Table, other_table: Table, type: Link_Field_Type);
    }
    class Table {
        public name: string;
        public properties: {};
        public indexes: any[];
        public ground: Ground.Core;
        public db_name: string;
        public trellis: Ground.Trellis;
        public primary_keys: any[];
        public query: string;
        public links: {};
        constructor(name: string, ground: Ground.Core);
        public connect_trellis(trellis: Ground.Trellis): void;
        static create_from_trellis(trellis: Ground.Trellis, ground?: Ground.Core): Table;
        static get_other_table(property: Ground.Property): Table;
        static get_other_table_name(property: Ground.Property): string;
        public create_link(property: Ground.Property): void;
        public create_sql(ground: Ground.Core): string;
        static create_sql_from_array(table_name: string, source: any[], primary_keys?: any[], indexes?: any[]): string;
        public create_sql_from_trellis(trellis: Ground.Trellis): string;
        private get_primary_keys(trellis);
        static format_value(value: any): any;
        static generate_index_sql(index: any): string;
        public load_from_schema(source: any): void;
    }
}
declare module Ground {
    interface Identity {
        name: string;
        trellis: Ground.Trellis;
        keys: Identity_Key[];
    }
    interface Identity_Key {
        name: string;
        type: string;
        property: Ground.Property;
    }
    class Link_Trellis implements Ground.ITrellis {
        public properties: any;
        public seed: any;
        public table_name: string;
        public trellises: Ground.Trellis[];
        public trellis_dictionary: {};
        public identities: Identity[];
        public alias: string;
        constructor(trellises: Ground.Trellis[], table_name?: string);
        public create_identity(trellis: Ground.Trellis): Identity;
        static create_from_property(property: Ground.Property): Link_Trellis;
        static create_reference(property: Ground.Property, name: string): Identity_Key;
        public generate_join(seeds: {}): string;
        public generate_delete_row(seeds: any[]): string;
        public generate_insert(seeds: any): string;
        private generate_table_name();
        public get_key_condition(key: Identity_Key, seed: any, fill_blanks?: boolean): string;
        public get_condition_string(seeds: any): string;
        public get_identity_conditions(identity: Identity, seed: any, fill_blanks?: boolean): any[];
        public get_conditions(seeds: any): string[];
        public get_identity_by_trellis(trellis: Ground.Trellis): Identity;
        public get_table_declaration(): string;
    }
}
declare module Ground {
    module SQL {
        function get_link_sql_value(link: Ground.Link_Field, value: any): any;
    }
}
declare module Ground {
    enum Relationships {
        none = 0,
        one_to_one = 1,
        one_to_many = 2,
        many_to_many = 3,
    }
    class Property {
        public name: string;
        public parent: Ground.Trellis;
        public type: string;
        public insert: string;
        public other_property: string;
        public "default": any;
        public other_trellis: Ground.Trellis;
        public other_trellis_name: string;
        public is_private: boolean;
        public is_parent: boolean;
        public is_readonly: boolean;
        public is_virtual: boolean;
        public is_composite_sub: boolean;
        public is_unique: boolean;
        public composite_properties: any[];
        public access: string;
        public allow_null: boolean;
        constructor(name: string, source: Ground.IProperty_Source, trellis: Ground.Trellis);
        public initialize_composite_reference(other_trellis: Ground.Trellis): void;
        public fullname(): string;
        public get_allow_null(): boolean;
        public get_composite(): Property[];
        public get_data(): Ground.IProperty_Source;
        public get_default(): any;
        public get_field_name(): string;
        public get_field_override(create_if_missing?: boolean): Ground.IField;
        public get_field_type(): any;
        public get_seed_name(): string;
        public get_sql_value(value: any, type?: any, is_reference?: boolean): any;
        public get_type(): string;
        public get_other_id(entity: any): any;
        public get_other_property(create_if_none?: boolean): Property;
        public get_property_type(): Ground.Property_Type;
        public get_referenced_trellis(): Ground.Trellis;
        public get_relationship(): Relationships;
        public get_field_query(): string;
        public query(): string;
        public export_schema(): Ground.IProperty_Source;
    }
}
declare module Ground {
    interface Expression {
        type?: string;
    }
    class Expression_Engine {
        static resolve(expression: any, context: any): any;
        static resolve_function(expression: Ground.Function_Expression, context: any): void;
    }
}
declare module Ground {
    class Record_Count extends MetaHub.Meta_Object {
        public ground: Ground.Core;
        public parent: Ground.Trellis;
        public child: Ground.Trellis;
        public count_name: string;
        constructor(ground: Ground.Core, parent: any, property_name: string, count_name: string);
        public count(seed: any): Promise;
    }
    class Join_Count extends MetaHub.Meta_Object {
        public ground: Ground.Core;
        public parent: Ground.Trellis;
        public link: Ground.Cross_Trellis;
        public count_name: string;
        public property: Ground.Property;
        constructor(ground: Ground.Core, property: Ground.Property, count_name: string);
        public count(seed: any, property: Ground.Property): Promise;
    }
    class Multi_Count extends MetaHub.Meta_Object {
        public ground: Ground.Core;
        public trellis: Ground.Trellis;
        public count_name: string;
        public count_fields: string[];
        constructor(ground: Ground.Core, trellis: string, count_name: any, sources: MetaHub.Meta_Object[]);
        public count(key: any): Promise;
    }
}
declare module Ground {
    interface Statement {
        type: string;
    }
    interface Constraint_Statement extends Statement {
        trellis: string;
        property: string;
        expression: Ground.Expression;
    }
    interface Symbol_Statement extends Statement {
        name: string;
        expression: Ground.Expression;
    }
    interface Function_Expression extends Ground.Expression {
        name: string;
        arguments: Ground.Expression[];
    }
    interface Reference_Expression extends Ground.Expression {
        path: string;
    }
    class Scope {
        public symbols: {};
        public add_symbol(name: string, value: any): void;
    }
    class Logic {
        static load(ground: Ground.Core, statements: Statement[]): void;
        static load_constraint(ground: Ground.Core, source: Constraint_Statement, scope: Scope): MetaHub.Meta_Object;
        static create_symbol(ground: Ground.Core, source: Symbol_Statement, scope: Scope): void;
    }
}
declare module Ground {
    interface IJoin {
        render(): string;
    }
    interface Join_Trellis {
        get_table_name(): string;
        get_primary_keys(): Join_Property[];
        get_alias(): string;
        query_identity(): string;
    }
    class Join_Trellis_Wrapper implements Join_Trellis {
        public trellis: Ground.Trellis;
        public alias: string;
        constructor(trellis: Ground.Trellis, alias?: string);
        static create_using_property(trellis: Ground.Trellis, property: Ground.Property): Join_Trellis_Wrapper;
        public get_alias(): string;
        public get_primary_keys(): Join_Property[];
        public get_table_name(): string;
        public query_identity(): string;
    }
    class Cross_Trellis implements Join_Trellis {
        public name: string;
        public alias: string;
        public properties: Join_Property[];
        public identities: Join_Property[];
        constructor(property: Ground.Property);
        static generate_name(first: Ground.Trellis, second: Ground.Trellis): string;
        private static get_field_name(property);
        public get_primary_keys(): Join_Property[];
        private static create_properties(cross, property);
        public generate_delete(property: Ground.Property, owner: any, other: any): string;
        public generate_insert(property: Ground.Property, owner: any, other: any): string;
        public order_identities(property: Ground.Property): Join_Property[];
        public get_alias(): string;
        public get_table_name(): string;
        public query_identity(): string;
    }
    class Cross_Trellis2 {
        public alias: string;
        public table: Ground.Table;
        constructor(property: Ground.Property, alias?: string);
        public generate_insert(property: Ground.Property, owner: any, other: any): string;
        public order_identities(property: Ground.Property): Ground.Link_Field[];
    }
    class Join_Property {
        public parent: Join_Trellis;
        public other_trellis: Join_Trellis;
        public field_name: string;
        public type: string;
        public other_property: Join_Property;
        public name: string;
        public property: Ground.Property;
        constructor(parent: Join_Trellis, other_trellis: Join_Trellis, name: string, type: string, field_name?: string, other_property?: Join_Property);
        static create_from_property(property: Ground.Property, other_trellis?: Join_Trellis, other_property?: Join_Property): Join_Property;
        public get_comparison(value: any): string;
        public query(): string;
        static pair(first: Join_Property, second: Join_Property): void;
        public get_sql_value(value: any): any;
    }
    class Join_Tree {
        public property: Ground.Property;
        public trellis: Ground.Trellis;
        public children: Join_Tree[];
        constructor(property: Ground.Property, trellis: Ground.Trellis);
        static get(tree: Join_Tree[], property: Ground.Property, next: Ground.Trellis): Join_Tree;
    }
    class Join {
        static generate_table_name(trellis: Ground.Trellis, property: Ground.Property): string;
        static get_last_reference(property_chain: Ground.Property[]): Ground.Property;
        static paths_to_tree(base: Ground.Trellis, paths: any[]): Join_Tree[];
        private static convert(branch, previous, result);
        static tree_to_joins(tree: Join_Tree[], previous?: Join_Trellis): IJoin[];
        static render_paths(trellis: Ground.Trellis, paths: Ground.Property[][]): string[];
        static path_to_property_chain(base: Ground.Trellis, path: any): Ground.Property[];
        static get_end_query(property_chain: Ground.Property[]): string;
    }
    class Reference_Join implements IJoin {
        public property: Join_Property;
        public first: Join_Trellis;
        public second: Join_Trellis;
        constructor(property: Join_Property, first: Join_Trellis, second: Join_Trellis);
        public render(): string;
        private get_condition();
        private get_query_reference(trellis, property);
    }
    class Composite_Join implements IJoin {
        public first: Join_Trellis;
        public second: Join_Trellis;
        constructor(first: Join_Trellis, second: Join_Trellis);
        public render(): string;
        private get_condition();
    }
}
declare module Ground {
    interface IPager {
        limit?: any;
        offset?: any;
    }
    interface Query_Filter_Source {
        property?: string;
        path?: string;
        value: any;
        operator?: string;
    }
    interface Query_Filter {
        path?: string;
        property?: Ground.Property;
        value: any;
        operator?: string;
    }
    interface Condition_Source {
        path?: string;
        value?: any;
        operator?: string;
        type?: string;
        expressions?: Condition_Source[];
    }
    interface Condition {
        path?: Ground.Property[];
        value?: any;
        operator?: string;
        type?: string;
        expressions?: Condition[];
    }
    interface Query_Sort {
        property?: any;
        path?: any;
        dir?: any;
    }
    interface Query_Transform {
        clause: string;
    }
    class Query_Builder {
        public ground: Ground.Core;
        public trellis: Ground.Trellis;
        public pager: IPager;
        public type: string;
        public properties: any;
        public condition: Condition;
        public sorts: Query_Sort[];
        public source: Ground.External_Query_Source;
        public include_links: boolean;
        public transforms: Query_Transform[];
        public subqueries: {};
        public map: {};
        public queries: Query_Builder[];
        static operators: {
            '=': any;
            'LIKE': {
                "render": (result: any, filter: any, property: any, data: any) => void;
            };
            '!=': any;
            '<': any;
            '>': any;
            '<=': any;
            '>=': any;
            '=>': any;
            '=<': any;
        };
        public filters: Query_Filter[];
        constructor(trellis: Ground.Trellis);
        static add_operator(symbol: string, action: any): void;
        public add_filter(path: string, value?: any, operator?: string): void;
        public create_condition(source: Condition_Source): Condition;
        public add_key_filter(value: any): void;
        public add_sort(sort: Query_Sort): void;
        public add_map(target: string, source?: any): void;
        public add_query(source: any): Query_Builder;
        public add_subquery(property_name: string, source?: any): Query_Builder;
        public add_transform_clause(clause: string): void;
        public create_runner(): Ground.Query_Runner;
        static create_join_filter(property: Ground.Property, seed: any): Query_Filter;
        public extend(source: any): void;
        public get_primary_key_value(): any;
        public run(): Promise;
        public run_single(): Promise;
    }
}
declare module Ground {
    interface Internal_Query_Source {
        fields?: any;
        filters?: any[];
        joins?: string[];
        property_joins?: Ground.Property[][];
        arguments?: any;
    }
    interface Query_Parts {
        fields: string;
        from: string;
        joins: string;
        filters: string;
        sorts: string;
        pager: string;
        args: any;
    }
    class Query_Renderer {
        public ground: Ground.Core;
        static counter: number;
        constructor(ground: Ground.Core);
        static apply_arguments(sql: string, args: any): string;
        static get_properties(source: Ground.Query_Builder): {};
        static generate_property_join(property: Ground.Property, seeds: any): string;
        public generate_sql(parts: Query_Parts, source: Ground.Query_Builder): string;
        public generate_count(parts: Query_Parts): string;
        public generate_union(parts: Query_Parts, queries: string[], source: Ground.Query_Builder): string;
        public generate_union_count(parts: Query_Parts, queries: string[], source: Ground.Query_Builder): string;
        public generate_parts(source: Ground.Query_Builder, query_id?: number): Query_Parts;
        private static get_fields_and_joins(source, properties, include_primary_key?);
        private static add_path(path, trellis, result);
        static get_chain(path: any, trellis: Ground.Trellis): Ground.Property[];
        private static add_chain(property_chain, result);
        private static build_filter(source, filter, ground);
        private static prepare_condition(source, condition, ground);
        static build_filters(source: Ground.Query_Builder, ground: Ground.Core): Internal_Query_Source;
        static process_sorts(sorts: Ground.Query_Sort[], trellis: Ground.Trellis, result: Internal_Query_Source): string;
        static render_pager(pager: Ground.IPager): string;
    }
}
declare module Ground {
    interface IQuery_Preparation {
        queries?: string[];
        is_empty: boolean;
    }
    interface IQuery_Render_Result {
        sql: string;
        parts: any;
    }
    class Query_Runner {
        public source: Ground.Query_Builder;
        public run_stack: any;
        private row_cache;
        public ground: Ground.Core;
        public renderer: Ground.Query_Renderer;
        constructor(source: Ground.Query_Builder);
        private static generate_property_join(property, seeds);
        private static create_sub_query(trellis, property, source);
        private static get_many_list(seed, property, relationship, source);
        private static get_path(...args);
        private static get_reference_object(row, property, source);
        public process_map(row: any, source: Ground.Query_Builder, links: any): any;
        public process_row_step_one(row: any, source: Ground.Query_Builder): Promise;
        public process_row_step_two(row: any, source: Ground.Query_Builder, trellis: Ground.Trellis): Promise;
        public query_link_property(seed: any, property: any, source: Ground.Query_Builder): Promise;
        public prepare(): Promise;
        public render(query_id?: number): Promise;
        public run_core(): Promise;
        public get_source(row: any): Ground.Query_Builder;
        public run(): Promise;
        public run_single(): Promise;
    }
}
declare module "vineyard-ground" {
  export = Ground
}