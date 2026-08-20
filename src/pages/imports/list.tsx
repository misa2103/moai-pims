import * as React from "react";
import { List, useDataGrid, DateField, ShowButton } from "@refinedev/mui";
import { HttpError } from "@refinedev/core";
import { DataGrid, GridColDef, GridToolbar } from "@mui/x-data-grid";
import { Box, LinearProgress, Stack, Typography } from "@mui/material";

const fmtPct = (v?: number) => (typeof v === "number" ? `${v.toFixed(1)}%` : "0%");

export const ImportBatchList: React.FC = () => {
  const { dataGridProps } = useDataGrid<any, HttpError>({
    resource: "v_product_import_batch_stats",
    initialPageSize: 25,
    syncWithLocation: true,
    sorters: { initial: [{ field: "created_at", order: "desc" }] },
    liveMode: "off",
    queryOptions: {
      refetchInterval: 15000,
    },
  });

  const columns = React.useMemo<GridColDef[]>(
    () => [
      {
        field: "actions",
        headerName: "Actions",
        sortable: false,
        filterable: false,
        width: 90,
        renderCell: ({ row }) => <ShowButton hideText resource="imports" recordItemId={row.id} />,
      },
      { field: "id", headerName: "Batch ID", flex: 1, minWidth: 220 },
      { field: "source", headerName: "Source", width: 110 },
      { field: "status", headerName: "Status", width: 120 },
      { field: "total", headerName: "Total", width: 90 },
      { field: "queued", headerName: "Queued", width: 90 },
      { field: "processing", headerName: "Processing", width: 110 },
      { field: "done", headerName: "Done", width: 90 },
      { field: "errors", headerName: "Errors", width: 90 },
      {
        field: "pct_done",
        headerName: "Progress",
        width: 200,
        renderCell: ({ value }) => (
          <Stack sx={{ width: "100%" }}>
            <LinearProgress
              variant="determinate"
              value={Number(value || 0)}
              sx={{ height: 8, borderRadius: 5 }}
            />
            <Typography variant="caption">{fmtPct(value as number)}</Typography>
          </Stack>
        ),
      },
      {
        field: "created_at",
        headerName: "Created",
        width: 180,
        valueGetter: ({ value }) => value,
        renderCell: ({ value }) => <DateField value={value as string} format="PP pp" />,
      },
    ],
    []
  );

  return (
    <List title="Imports">
      <DataGrid
        {...dataGridProps}
        getRowId={(row) => row.id}
        columns={columns}
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
        slotProps={{
          toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 400 } },
        }}
      />
    </List>
  );
};
