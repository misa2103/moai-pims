import * as React from "react";
import { useParams } from "react-router-dom";
import { useOne, useInvalidate } from "@refinedev/core";
import { Show, List, useDataGrid } from "@refinedev/mui";
import {
  Box,
  Stack,
  Typography,
  Divider,
  Chip,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
} from "@mui/material";
import { DataGrid, GridColDef, GridToolbar } from "@mui/x-data-grid";
import type { LogicalFilter } from "@refinedev/core";
import { supabaseClient } from "../../utility";
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField } from "@mui/material";

const dt = new Intl.DateTimeFormat("en-MU", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Indian/Mauritius",
});
const fmtDT = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : dt.format(d);
};

const BUCKET = "imports";
const FOLDER = "generated_po";

// ── N8N webhook URL ──────────────────────────────────────────────────────────
const CREATE_PO_WEBHOOK_URL = `${import.meta.env.VITE_N8N_BASE_URL}${import.meta.env.VITE_WEBHOOK_CREATE_PO}`;

const buildStoragePath = (input?: string | null) => {
  if (!input) return undefined;
  const clean = String(input).replace(/^\/+/, "");
  if (clean.startsWith(`${FOLDER}/`)) return clean;
  const fileOnly = clean.split("/").pop() ?? clean;
  return `${FOLDER}/${fileOnly}`;
};

type SnackState = { open: boolean; severity: "success" | "error" | "info" | "warning"; message: string; };

export const ImportBatchShow: React.FC = () => {
  const { id } = useParams();
  const invalidate = useInvalidate();

  const [downloading, setDownloading] = React.useState(false);
  const [creatingPO, setCreatingPO] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [reseting, setReseting] = React.useState(false);
  const showSnack = (severity: SnackState["severity"], message: string) => setSnack({ open: true, severity, message });

  // Snackbar state
  const [snack, setSnack] = React.useState<SnackState>({ open: false, severity: "info", message: "", });

  const [poDialogOpen, setPoDialogOpen] = React.useState(false);
  const [plannedDate, setPlannedDate] = React.useState<string>(() => {
    // Défaut : aujourd'hui + 30 jours
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0]; // format YYYY-MM-DD
  });

  const closeSnack = () => setSnack((s) => ({ ...s, open: false }));

  // ── Fetch batch header ─────────────────────────────────────────────────────
  const { data: batch, isLoading: isBatchLoading } = useOne({
    resource: "v_product_import_batch_stats",
    id,
    liveMode: "off",
    queryOptions: {
      enabled: !!id,
      refetchInterval: (data) =>
        data?.data?.status === "processing" ? 5000 : false,
    },
  });

  // ── Permanent filter for items grid ───────────────────────────────────────
  const permanentFilters: LogicalFilter[] = React.useMemo(
    () =>
      id ? [{ field: "batch_id", operator: "eq" as const, value: id }] : [],
    [id]
  );

  const { dataGridProps } = useDataGrid({
    resource: "v_product_import_items",
    filters: { permanent: permanentFilters },
    initialPageSize: 50,
    liveMode: "off",
    sorters: { initial: [{ field: "created_at", order: "asc" }] },
    queryOptions: {
      enabled: !!id,
      keepPreviousData: true,
      refetchInterval: 5000,
    },
  });

  const columns = React.useMemo<GridColDef[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 140, flex: 0.6 },
      { field: "quantity", headerName: "Qty", width: 80 },
      { field: "status", headerName: "Status", width: 120 },
      { field: "attempts", headerName: "Attempts", width: 100 },
      {
        field: "updated_at",
        headerName: "Updated",
        width: 180,
        renderCell: (params) => (
          <span>{fmtDT((params?.value as string) ?? null)}</span>
        ),
      },
      { field: "error_message", headerName: "Error", minWidth: 220, flex: 1 },
    ],
    []
  );

  // ── Download PO (unchanged logic) ─────────────────────────────────────────
  const handleDownload = async () => {
    const path = buildStoragePath(batch?.data?.po_file_path);
    if (!path) return;

    try {
      setDownloading(true);

      const { data, error } = await supabaseClient.storage
        .from(BUCKET)
        .createSignedUrl(path, 60);

      if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");

      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error("Failed to fetch file");
      const blob = await res.blob();

      const fileName = path.split("/").pop() || "download.xlsx";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch (e) {
      console.error(e);
      alert("Could not download the file.");
    } finally {
      setDownloading(false);
    }
  };

  // ── Create PO in Odoo via n8n webhook ─────────────────────────────────────
  const handleCreatePO = async () => {
    if (!id) return;
    try {
      setCreatingPO(true);

      const res = await fetch(CREATE_PO_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: id,
          date_planned: plannedDate, // ✅ ajout
        }),
      });

      if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
      const data = await res.json();

      if (data?.success && data?.po_name) {
        showSnack("success", `PO created successfully: ${data.po_name}`);
      } else {
        throw new Error("Unexpected response from webhook");
      }
    } catch (e) {
      console.error(e);
      showSnack("error", "Failed to create PO in Odoo. Please try again.");
    } finally {
      setCreatingPO(false);
    }
  };

  // ── Reset stuck import (séquentiel comme tes requêtes SQL) ──
  const handleReset = async () => {
    if (!id) return;
    try {
      setReseting(true);

      // ÉTAPE 1 : Reset items du batch courant
      const { data: updatedItems, error: itemsError } = await supabaseClient
        .from("product_import_items")
        .update({
          status: "queued",
          updated_at: new Date().toISOString(),
          attempts: 0,
          error_message: null,
        })
        .eq("batch_id", id)
        .eq("status", "processing")
        .select("id, sku");

      if (itemsError) throw itemsError;

      const itemsCount = updatedItems?.length ?? 0;
      console.log("🚀 ~ handleReset ~ itemsCount:", itemsCount);

      // ÉTAPE 2 : Reset batch après que les items soient done
      const { error: batchError } = await supabaseClient
        .from("product_import_batches")
        .update({ status: "queued" })
        .eq("id", id);

      if (batchError) throw batchError;

      // ÉTAPE 3 : Reset uniquement les produits liés à ce batch
      if (itemsCount > 0) {
        const skus = updatedItems.map((item) => item.sku).filter(Boolean);

        if (skus.length > 0) {
          const { error: productsError } = await supabaseClient
            .from("products")
            .update({ sync_status: "pending" })
            .in("sku", skus)
            .eq("sync_status", "processing");

          if (productsError) throw productsError;
        }
      }

      showSnack(
        "success",
        `Import reset successfully. ${itemsCount} item(s) reset to queued.`
      );

      await invalidate({
        resource: "v_product_import_batch_stats",
        invalidates: ["detail"],
        id,
      });

      await invalidate({
        resource: "v_product_import_items",
        invalidates: ["list"],
      });
    } catch (e: unknown) {
      console.error("❌ Reset failed:", e);
      showSnack("error", e instanceof Error ? e.message : "Failed to reset import");
    } finally {
      setReseting(false);
    }
  };

  const handleCancel = async () => {
    if (!id) return;

    try {
      setCancelling(true);

      // 1 — Cancel items encore en queue
      const { error: itemsError } = await supabaseClient
        .from("product_import_items")
        .update({
          status: "cancelled",
          error_message: "Import annulé manuellement",
          updated_at: new Date().toISOString(),
        })
        .eq("batch_id", id)
        .eq("status", "queued");

      if (itemsError) throw itemsError;

      // 2 — Cancel batch
      const { error: batchError } = await supabaseClient
        .from("product_import_batches")
        .update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
          note: "Import annulé manuellement",
        })
        .eq("id", id);

      if (batchError) throw batchError;

      showSnack("warning", "Import annulé.");

      // Reset UI
      await invalidate({
        resource: "v_product_import_batch_stats",
        invalidates: ["detail"],
        id,
      });

      await invalidate({
        resource: "v_product_import_items",
        invalidates: ["list"],
      });

    } catch (e: unknown) {
      console.error(e);
      const message =
        e instanceof Error ? e.message : "Failed to cancel import";
      showSnack("error", message);
    } finally {
      setCancelling(false);
    }
  };

  const batchStatus = batch?.data?.status;

  const canCancel = !cancelling && ["queued", "processing"].includes(batchStatus);
  const canReset = !reseting && batchStatus === "processing";

  return (
    <Show
      title="Import Batch"
      canDelete={false}
      canEdit={false}
      isLoading={isBatchLoading}
      goBack={false}
      headerButtons={
        <Stack direction="row" spacing={1}>
          {/* Reset — visible when batch is processing (stuck items) */}
          {canReset && (
            <Button
              variant="outlined"
              color="warning"
              onClick={handleReset}
              disabled={reseting}
              startIcon={
                reseting ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {reseting ? "Reseting..." : "Reset IMPORT"}
            </Button>
          )}

          {/* Cancel — only visible when batch is queued or processing */}
          {canCancel && (
            <Button
              variant="outlined"
              color="error"
              onClick={handleCancel}
              disabled={cancelling} > {cancelling ? "Cancelling..." : "Cancel Import"}
            </Button>)}
          {/* Download PO — same logic as before */}
          <Button
            variant="outlined"
            onClick={handleDownload}
            disabled={batchStatus !== "done" || downloading}
          >
            {downloading ? "Downloading..." : "Download PO"}
          </Button>

          {/* Create PO in Odoo — same activation condition as Download PO */}
          <Button
            variant="contained"
            onClick={() => setPoDialogOpen(true)}
            disabled={batchStatus !== "done" || creatingPO}
            startIcon={
              creatingPO ? <CircularProgress size={16} color="inherit" /> : undefined
            }
          >
            {creatingPO ? "Creating PO..." : "Create PO in Odoo"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Batch</Typography>
          <Typography variant="body2" color="text.secondary">
            ID: {batch?.data?.id ?? "—"}
          </Typography>

          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <Chip size="small" label={batch?.data?.source ?? "—"} />
            <Chip size="small"
              color={batchStatus === "done" ? "success" : batchStatus === "error" ? "error" : batchStatus === "cancelled" ? "warning" : "primary"} label={batchStatus ?? "—"} />
          </Stack>

          <Stack direction="row" spacing={4} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Created: {fmtDT(batch?.data?.created_at)}
            </Typography>
            <Typography variant="body2">
              Started: {fmtDT(batch?.data?.started_at)}
            </Typography>
            <Typography variant="body2">
              Finished: {fmtDT(batch?.data?.finished_at)}
            </Typography>
          </Stack>

          {batch?.data?.file_path && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              File: {batch.data.file_path}
            </Typography>
          )}
        </Box>

        <Divider />

        <List title="Items">
          <DataGrid
            {...dataGridProps}
            getRowId={(row) => row.id}
            columns={columns}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            slotProps={{
              toolbar: {
                showQuickFilter: false,
                quickFilterProps: { debounceMs: 400 },
              },
            }}
          />
        </List>
      </Stack>

      <Dialog open={poDialogOpen} onClose={() => setPoDialogOpen(false)}>
        <DialogTitle>Create PO in Odoo</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Set the expected arrival date for this purchase order.
            This date will be used as the scheduled delivery date in Odoo.
          </Typography>
          <TextField
            label="Expected Arrival Date"
            type="date"
            fullWidth
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: new Date().toISOString().split("T")[0] }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPoDialogOpen(false)} disabled={creatingPO}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!plannedDate || creatingPO}
            startIcon={
              creatingPO ? (
                <CircularProgress size={16} color="inherit" />
              ) : undefined
            }
            onClick={async () => {
              setPoDialogOpen(false); // ferme le dialog
              await handleCreatePO(); // le spinner apparaît sur le bouton header
            }}
          >
            {creatingPO ? "Creating..." : "Confirm & Create PO"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation / error snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={closeSnack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={closeSnack}
          severity={snack.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Show>
  );
};