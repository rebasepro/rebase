// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import ordersCollection from "./orders";
import territoriesCollection from "./territories";

const employeesCollection = defineCollection({
    name: "Employees",
    singularName: "Employee",
    slug: "employees",
    table: "employees",
    properties: {
        employeeId: {
            name: "Employee Id",
            columnName: "employee_id",
            type: "number",
            isId: "manual",
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
        titleOfCourtesy: {
            name: "Title Of Courtesy",
            columnName: "title_of_courtesy",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 25
            },
        },
        firstName: {
            name: "First Name",
            columnName: "first_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 10
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
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 60
            },
        },
        city: {
            name: "City",
            columnName: "city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        region: {
            name: "Region",
            columnName: "region",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
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
        country: {
            name: "Country",
            columnName: "country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        homePhone: {
            name: "Home Phone",
            columnName: "home_phone",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        extension: {
            name: "Extension",
            columnName: "extension",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 4
            },
        },
        birthDate: {
            name: "Birth Date",
            columnName: "birth_date",
            type: "date",
            columnType: "date",
        },
        hireDate: {
            name: "Hire Date",
            columnName: "hire_date",
            type: "date",
            columnType: "date",
        },
        reportsTo: {
            name: "ReportsTo",
            type: "relation",
            // mapped from foreign key: reports_to -> employees(employee_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => employeesCollection,
                localKey: "reports_to",
                onDelete: "no action"
            }
        },
        notes: {
            name: "Notes",
            columnName: "notes",
            type: "string",
            admin: {
                multiline: true
            },
        },
        photoPath: {
            name: "Photo Path",
            columnName: "photo_path",
            type: "string",
            storage: {
                storagePath: "employees/photo_path"
            },
            columnType: "varchar",
            validation: {
                max: 255
            },
        },
        photo: {
            name: "Photo",
            columnName: "photo",
            type: "binary",
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "employees",
            target: (): AnyCollectionConfig => employeesCollection,
            // the employees.reports_to FK points back here
            foreignKeyOnTarget: "reports_to"
        },
        {
            kind: "hasMany",
            relationName: "orders",
            target: (): AnyCollectionConfig => ordersCollection,
            // the orders.employee_id FK points back here
            foreignKeyOnTarget: "employee_id"
        },
        {
            kind: "manyToMany",
            relationName: "territories",
            target: (): AnyCollectionConfig => territoriesCollection,
            through: {
                table: "employee_territories",
                sourceColumn: "employee_id",
                targetColumn: "territory_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "lastName" },
        listProperties: [
            "employeeId",
            "title",
            "titleOfCourtesy",
            "firstName",
            "lastName",
            "address"
        ],
        propertiesOrder: [
            "employeeId",
            "title",
            "titleOfCourtesy",
            "firstName",
            "lastName",
            "address",
            "city",
            "region",
            "postalCode",
            "country",
            "homePhone",
            "extension",
            "birthDate",
            "hireDate",
            "reportsTo",
            "notes",
            "photoPath",
            "photo"
        ]
    }
});

export default employeesCollection;
