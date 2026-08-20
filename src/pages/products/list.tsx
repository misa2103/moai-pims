import * as React from "react";
import { CreateButton, List, ShowButton, useDataGrid } from "@refinedev/mui";
import { HttpError, useUpdate, useInvalidate, useNotification } from "@refinedev/core";
import {
    DataGrid,
    GridColDef,
    GridToolbar,
    GridRowModel,
} from "@mui/x-data-grid";
import { Box } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";

type FlatRow = {
    id: string; // product_id
    search_name: string;
    quantity?: number;
    duty_tax?: number;
    transport?: number;
    margin?: number;
    price_supplier?: number;
    total_price_supplier?: number;
    unit_price_mur?: number;
    sales_price?: number;
    sales_price_shop?: number;
    stock_available?: number;
    ean_code?: string;
    intrastat?: string;
    long_desc_en?: string;
};

const EDITABLE_FIELDS = new Set<keyof FlatRow>([
    "quantity",
    "duty_tax",
    "transport",
    "margin",
    "sales_price_shop",
]);

const NUMERIC_FIELDS = new Set<keyof FlatRow>([
    "quantity",
    "duty_tax",
    "transport",
    "margin",
    "sales_price_shop",
]);

const SUPABASE_META_PK = { idColumnName: "product_id" };

function toNumberOrZero(value: unknown): number {
    if (value === null || value === undefined || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export const ProductList = () => {
    const { dataGridProps, setFilters } = useDataGrid<FlatRow, HttpError>({
        resource: "product_flat_table",
        initialPageSize: 25,
        syncWithLocation: true,
        sorters: { initial: [{ field: "modified_on", order: "desc" }] },
        meta: {
            select: "id,search_name,quantity,duty_tax,transport,margin,price_supplier,total_price_supplier,unit_price_mur,sales_price,sales_price_shop,stock_available,ean_code,intrastat,long_desc_en,sync_status",
        },
    });

    const [search, setSearch] = React.useState("");

    const { mutate: updatePrice } = useUpdate();
    const invalidate = useInvalidate();
    const { open: notify } = useNotification();

    // Called by DataGrid when an edit is committed (cell/row)
    const processRowUpdate = React.useCallback(
        async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
            const productId = String(newRow.id ?? "");
            if (!productId) {
                throw new Error("Missing product id for update");
            }

            // Compute the diff for editable fields only
            const patch: Record<string, any> = {};
            let hasChange = false;

            EDITABLE_FIELDS.forEach((field) => {
                const newVal = (newRow as any)[field];
                const oldVal = (oldRow as any)[field];

                // normalize numbers
                const normalizedNew = NUMERIC_FIELDS.has(field)
                    ? toNumberOrZero(newVal)
                    : newVal;

                const normalizedOld = NUMERIC_FIELDS.has(field)
                    ? toNumberOrZero(oldVal)
                    : oldVal;

                if (normalizedNew !== normalizedOld) {
                    hasChange = true;
                    patch[String(field)] = normalizedNew;
                }
            });

            if (!hasChange) {
                return newRow; // nothing to do
            }

            // Persist to product_prices (id = product_id)
            await new Promise<void>((resolve, reject) => {
                updatePrice(
                    {
                        resource: "product_prices",
                        id: productId,
                        values: patch,
                        meta: SUPABASE_META_PK
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (err) => reject(err),
                    },
                );
            });

            // Invalidate the flat view so derived fields refresh
            invalidate({
                resource: "product_flat_table",
                invalidates: ["list", "many"],
            });

            notify?.({
                type: "success",
                message: "Saved",
                description: Object.keys(patch).join(", ") + " updated",
            });

            // Return the updated row for optimistic UI
            return { ...oldRow, ...newRow, ...patch };
        },
        [updatePrice, invalidate, notify],
    );

    const handleProcessRowUpdateError = React.useCallback((error: any) => {
        notify?.({
            type: "error",
            message: "Update failed",
            description: error?.message ?? "Could not update the value",
        });
    }, [notify]);

    const columns = React.useMemo<GridColDef[]>(
        () => [
            {
                field: "actions",
                headerName: "Actions",
                sortable: false,
                filterable: false,
                width: 80,
                renderCell: ({ row }) => (
                    <Box sx={{ display: "flex", gap: 1 }}>
                        <ShowButton hideText resource="product_flat_table" recordItemId={row.id} />
                    </Box>
                ),
            },
            { field: "search_name", headerName: "SKU", minWidth: 80, flex: 0.6 },
            { field: "quantity", headerName: "Quantity", minWidth: 80, flex: 0.6, editable: true, type: "number" },
            { field: "duty_tax", headerName: "Duty Tax", minWidth: 80, flex: 0.6, editable: true, type: "number" },
            { field: "transport", headerName: "Transport", minWidth: 80, flex: 0.6, editable: true, type: "number" },
            { field: "margin", headerName: "Margin", minWidth: 80, flex: 0.6, editable: true, type: "number" },
            { field: "price_supplier", headerName: "Cost(Eur)", minWidth: 90, flex: 0.6, type: "number" },
            { field: "total_price_supplier", headerName: "Total Cost(Eur)", minWidth: 120, flex: 0.6, type: "number" },
            { field: "unit_price_mur", headerName: "Unit Cost(Rs)", minWidth: 120, flex: 0.6, type: "number" },
            { field: "sales_price", headerName: "Sale Price(Rs)", minWidth: 120, flex: 0.6, type: "number" },
            { field: "sales_price_shop", headerName: "Web Sale Price(Rs)", minWidth: 160, flex: 0.6, editable: true, type: "number" },
            { field: "stock_available", headerName: "Stk OnOrder", minWidth: 120, type: "number" },
            { field: "ean_code", headerName: "EAN", minWidth: 160, flex: 0.6 },
            { field: "intrastat", headerName: "Intrastat", minWidth: 120 },
            { field: "long_desc_en", headerName: "Name", minWidth: 340, flex: 1.4 },
            { field: "sync_status", headerName: "Status", minWidth: 340, flex: 1.4 },
        ],
        [],
    );

    return (
        <List title="Products"
            headerButtons={({ defaultButtons }) => (
                <>
                    {defaultButtons}
                    <CreateButton
                        resource="imports"
                        startIcon={<UploadFileIcon />}
                    >
                        Import File
                    </CreateButton>
                </>
            )}
        >
            <DataGrid
                {...dataGridProps}
                getRowId={(row) => row.id}
                columns={columns}
                checkboxSelection
                disableRowSelectionOnClick
                slots={{ toolbar: GridToolbar }}
                slotProps={{
                    toolbar: {
                        showQuickFilter: true,
                        quickFilterProps: {
                            debounceMs: 400,
                            value: search,
                            onChange: (e) => {
                                const value = e.target.value;
                                setSearch(value);

                                setFilters([
                                    {
                                        field: "search_name",
                                        operator: "contains",
                                        value,
                                    },
                                ]);
                            },
                        },
                    },
                }}
                // Persist edits via the modern API
                processRowUpdate={processRowUpdate}
                onProcessRowUpdateError={handleProcessRowUpdateError}
            />
        </List>
    );
};
