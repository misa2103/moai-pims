import * as React from "react";
import { CreateButton, List, ShowButton, useDataGrid } from "@refinedev/mui";
import { HttpError, useUpdate, useInvalidate, useNotification } from "@refinedev/core";
import {
    DataGrid,
    GridColDef,
    GridToolbar,
    GridRowModel,
} from "@mui/x-data-grid";
import { Box, Chip, IconButton, Tooltip, CircularProgress } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import SyncIcon from "@mui/icons-material/Sync";

type IncwoWcStatus = "never_synced" | "syncing" | "synced" | "error" | null | undefined;

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
    sync_status?: string; // pipeline PIMS -> Odoo (import produit), distinct de incwo_wc_status
    // Statut de l'envoi manuel Incwo + WooCommerce (distinct de sync_status ci-dessus)
    incwo_wc_status?: IncwoWcStatus;
    incwo_wc_synced_at?: string | null;
    incwo_wc_error?: string | null;
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

// ---------------------------------------------------------------------------
// Config webhook n8n (envoi manuel d'un produit vers Incwo + WooCommerce)
//
// ATTENTION SECURITE: ces identifiants Basic Auth partent depuis le
// navigateur et sont donc visibles dans le bundle JS / les requetes reseau
// pour quiconque a acces a l'app. Acceptable pour un outil interne restreint,
// mais si un durcissement est necessaire plus tard, faire transiter cet appel
// par un petit backend/proxy qui detient le secret cote serveur.
// ---------------------------------------------------------------------------
const INCWO_WC_WEBHOOK_URL = import.meta.env.VITE_N8N_INCWO_WC_WEBHOOK_URL as string;
const INCWO_WC_WEBHOOK_USER = import.meta.env.VITE_N8N_INCWO_WC_WEBHOOK_USER as string;
const INCWO_WC_WEBHOOK_PASS = import.meta.env.VITE_N8N_INCWO_WC_WEBHOOK_PASS as string;

// Meme webhook n8n pour les deux cibles -- on distingue via le parametre
// "action" du body (meme convention que MWF_HERTEX_SYNC_V2 / deco design) :
//   - "import_incwo" : n'envoie/ne met a jour que Incwo, ne touche pas WC
//   - "full_sync"     : envoie/met a jour Incwo puis WooCommerce
// C'est au workflow n8n de brancher son traitement sur ce champ.
type SyncAction = "import_incwo" | "full_sync";

type SyncResponse = {
    success: boolean;
    sku: string;
    odoo_id?: number;
    incwo_id?: number | string | null;
    woo_id?: number | string | null;
    message: string;
};

async function sendProductToIncwoWc(sku: string, action: SyncAction): Promise<SyncResponse> {
    const auth = btoa(`${INCWO_WC_WEBHOOK_USER}:${INCWO_WC_WEBHOOK_PASS}`);

    const response = await fetch(INCWO_WC_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ sku, action }),
    });

    // Le workflow n8n repond toujours en JSON, meme en erreur (404 SKU
    // introuvable, 500 erreur de sync) - on tente donc de parser le corps
    // dans tous les cas pour recuperer le message metier.
    let payload: SyncResponse | null = null;
    try {
        payload = await response.json();
    } catch {
        // ignore, on retombe sur le message generique ci-dessous
    }

    if (!response.ok || !payload || payload.success !== true) {
        const message = payload?.message || `Echec de la synchronisation (HTTP ${response.status})`;
        throw new Error(message);
    }

    return payload;
}

const INCWO_WC_STATUS_CONFIG: Record<
    string,
    { label: string; color: "default" | "warning" | "success" | "error" }
> = {
    never_synced: { label: "Jamais envoye", color: "default" },
    syncing: { label: "En cours...", color: "warning" },
    synced: { label: "Synced", color: "success" },
    error: { label: "Erreur", color: "error" },
};


function IncwoWcStatusChip({ status, error }: { status: IncwoWcStatus; error?: string | null }) {
    const config = INCWO_WC_STATUS_CONFIG[status || "never_synced"] ?? INCWO_WC_STATUS_CONFIG.never_synced;
    return (
        <Tooltip title={status === "error" && error ? error : ""} disableHoverListener={!error}>
            <Chip size="small" label={config.label} color={config.color} variant={status === "synced" ? "filled" : "outlined"} />
        </Tooltip>
    );
}

export const ProductList = () => {
    const { dataGridProps, setFilters } = useDataGrid<FlatRow, HttpError>({
        resource: "product_flat_table",
        initialPageSize: 25,
        syncWithLocation: true,
        sorters: { initial: [{ field: "modified_on", order: "desc" }] },
        meta: {
            select:
                "id,search_name,quantity,duty_tax,transport,margin,price_supplier,total_price_supplier,unit_price_mur,sales_price,sales_price_shop,stock_available,ean_code,intrastat,long_desc_en,sync_status,incwo_wc_status,incwo_wc_synced_at,incwo_wc_error",
        },
    });

    const [search, setSearch] = React.useState("");

    // Lignes en cours d'envoi vers Incwo/WC (state local, la requete etant bloquante)
    const [sendingRowIds, setSendingRowIds] = React.useState<Set<string>>(new Set());

    const { mutate: updatePrice } = useUpdate();
    const invalidate = useInvalidate();
    const { open: notify } = useNotification();

    const handleSendToIncwoWc = React.useCallback(
        async (row: FlatRow, action: SyncAction) => {
            const sku = row.search_name?.trim();
            if (!sku) {
                notify?.({
                    type: "error",
                    message: "Envoi impossible",
                    description: "Ce produit n'a pas de SKU (search_name) renseigne.",
                });
                return;
            }

            setSendingRowIds((prev) => new Set(prev).add(row.id));

            const targetLabel = action === "import_incwo" ? "Incwo" : "Incwo + WooCommerce";

            try {
                const result = await sendProductToIncwoWc(sku, action);
                notify?.({
                    type: "success",
                    message: `Envoye vers ${targetLabel}`,
                    description: `${sku} - ${result.message}`,
                });
            } catch (error: any) {
                notify?.({
                    type: "error",
                    message: `Echec de l'envoi (${targetLabel})`,
                    description: error?.message ?? "Erreur inconnue durant la synchronisation",
                });
            } finally {
                setSendingRowIds((prev) => {
                    const next = new Set(prev);
                    next.delete(row.id);
                    return next;
                });
                // Le workflow n8n a deja ecrit le statut final dans Supabase
                // (incwo_wc_status/incwo_wc_synced_at/incwo_wc_error) - on
                // rafraichit juste la liste pour l'afficher.
                invalidate({
                    resource: "product_flat_table",
                    invalidates: ["list", "many"],
                });
            }
        },
        [invalidate, notify],
    );

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
                width: 160,
                renderCell: ({ row }) => {
                    const isSending = sendingRowIds.has(row.id);
                    return (
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                            <ShowButton hideText resource="product_flat_table" recordItemId={row.id} />
                            <Tooltip title="Envoyer vers Incwo uniquement">
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={isSending || !row.search_name}
                                        onClick={() => handleSendToIncwoWc(row, "import_incwo")}
                                    >
                                        {isSending ? <CircularProgress size={18} /> : <SyncIcon fontSize="small" />}
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Envoyer vers Incwo + WooCommerce">
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={isSending || !row.search_name}
                                        onClick={() => handleSendToIncwoWc(row, "full_sync")}
                                    >
                                        {isSending ? <CircularProgress size={18} /> : <CloudSyncIcon fontSize="small" />}
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Box>
                    );
                },
            },
            { field: "search_name", headerName: "SKU", minWidth: 80, flex: 0.6 },
            {
                field: "incwo_wc_status",
                headerName: "Incwo/WC Status",
                minWidth: 180,
                flex: 0.8,
                renderCell: ({ row }) => (
                    <IncwoWcStatusChip status={row.incwo_wc_status} error={row.incwo_wc_error} />
                ),
            },
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
            { field: "sync_status", headerName: "PIMS Status", minWidth: 100, flex: 0.8 },
        ],
        [sendingRowIds, handleSendToIncwoWc],
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

function toNumberOrZero(value: unknown): number {
    if (value === null || value === undefined || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}