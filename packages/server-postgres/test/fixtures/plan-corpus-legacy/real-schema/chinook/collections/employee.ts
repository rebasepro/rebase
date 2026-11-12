// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import customerCollection from "./customer";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "birth_date" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "hire_date" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const employeeCollection = defineCollection({
    name: "Employee",
    singularName: "Employee",
    slug: "employee",
    table: "employee",
    properties: {
        employeeId: {
            name: "Employee Id",
            columnName: "employee_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        title: {
            name: "Title",
            columnName: "title",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 30
            },
        },
        firstName: {
            name: "First Name",
            columnName: "first_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 20
            },
        },
        lastName: {
            name: "Last Name",
            columnName: "last_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 20
            },
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 60
            },
        },
        phone: {
            name: "Phone",
            columnName: "phone",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        state: {
            name: "State",
            columnName: "state",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 70
            },
        },
        city: {
            name: "City",
            columnName: "city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        country: {
            name: "Country",
            columnName: "country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        postalCode: {
            name: "Postal Code",
            columnName: "postal_code",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 10
            },
        },
        fax: {
            name: "Fax",
            columnName: "fax",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        birthDate: {
            name: "Birth Date",
            columnName: "birth_date",
            type: "date",
        },
        hireDate: {
            name: "Hire Date",
            columnName: "hire_date",
            type: "date",
        },
        reportsTo: {
            name: "ReportsTo",
            type: "relation",
            // mapped from foreign key: reports_to -> employee(employee_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => employeeCollection,
                localKey: "reports_to",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "customer",
            target: (): AnyCollectionConfig => customerCollection,
            // the customer.support_rep_id FK points back here
            foreignKeyOnTarget: "support_rep_id"
        },
        {
            kind: "hasMany",
            relationName: "employee",
            target: (): AnyCollectionConfig => employeeCollection,
            // the employee.reports_to FK points back here
            foreignKeyOnTarget: "reports_to"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "lastName" },
        listProperties: [
            "employeeId",
            "title",
            "firstName",
            "lastName",
            "email",
            "phone"
        ],
        propertiesOrder: [
            "employeeId",
            "title",
            "firstName",
            "lastName",
            "email",
            "phone",
            "state",
            "address",
            "city",
            "country",
            "postalCode",
            "fax",
            "birthDate",
            "hireDate",
            "reportsTo"
        ]
    }
});

export default employeeCollection;
