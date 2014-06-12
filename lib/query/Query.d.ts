/// <reference path="../references.d.ts" />
declare module Ground {
    interface IService_Response {
        objects: any[];
    }
    class Query {
        public ground: Ground.Core;
        public main_table: string;
        public joins: string[];
        public filters: string[];
        public post_clauses: any[];
        public limit: string;
        public trellis: Ground.Trellis;
        public db: Ground.Database;
        public include_links: boolean;
        public fields: string[];
        public base_path: string;
        public arguments;
        public expansions: string[];
        static log_queries: boolean;
        private links;
        constructor(trellis: Ground.Trellis, base_path?: string);
        public add_arguments(args): void;
        public add_filter(clause: string, arguments?: any[]): void;
        public add_property_filter(property, value?, like?: boolean): void;
        public add_key_filter(value): void;
        public add_field(clause: string, arguments?): void;
        public add_join(clause: string, arguments?): void;
        public add_property_join(property: Ground.Property, id, reverse?: boolean): void;
        public add_post(clause: string, arguments?): void;
        public add_expansion(clause): void;
        public add_link(property): void;
        public generate_pager(offset?: number, limit?: number): string;
        public generate_sql(properties): string;
        public get_fields_and_joins(properties: {
            [name: string]: Ground.Property;
        }, include_primary_key?: boolean): {
            fields: string[];
            joins: any[];
        };
        public get_many_list(id, property: Ground.Property, relationship: Ground.Relationships): Promise;
        public get_path(...args: string[]): string;
        public get_reference_object(row, property: Ground.Property): Promise;
        public has_expansion(path: string): boolean;
        public process_row(row, authorized_properties?): Promise;
        public run(arguments?: {}): Promise;
        public run_as_service(arguments?: {}): Promise;
    }
}
