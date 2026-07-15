

export type TypesCount = {
    number?: number,
    string?: number,
    boolean?: number,
    map?: TypesCountRecord,
    array?: TypesCount,
    date?: number,
    geopoint?: number,
    reference?: number,
    relation?: number,
    vector?: number,
    binary?: number,
};

export type TypesCountRecord = Record<string, TypesCount>;

export type ValuesCountEntry = {
    values: unknown[];
    valuesCount: Map<unknown, number>;
    mapValues?: ValuesCountRecord;
};

export type ValuesCountRecord = Record<string, ValuesCountEntry>;

export type InferencePropertyBuilderProps = {

    /**
     * Name of the property
     */
    name: string;

    /**
     * Total documents this props are built from
     */
    totalDocsCount: number;

    /**
     * How many times does each value show up
     */
    valuesResult?: ValuesCountEntry;
};
