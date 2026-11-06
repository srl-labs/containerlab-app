// Fields the slot details are built from: type pickers and the MDA and XIOM lists.
import React from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  nextMdaSlot,
  nextXiomSlot,
  XIOM_MDA_NOTE,
  XIOM_MDA_SLOTS,
  type HardwareTarget
} from "../../../../core/sros/srsimChassis";
import type { SrosMda, SrosXiom } from "../../../../core/types/editors";
import type { SrosComponentTypes } from "../../../../hooks/editor";
import { controlRadius } from "../../../../theme/surfaces";
import { FilterableDropdown } from "../../../ui/form";

export const ROW_ICON_SX = { fontSize: 16 } as const;
export const COLUMN_SX = { display: "flex", flexDirection: "column", gap: 1.5 } as const;
export const REMOVE_BUTTON_SX = {
  flexShrink: 0,
  "&:hover": {
    color: "error.main",
    bgcolor: "color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)"
  }
} as const;
const HEADER_ROW_SX = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  minHeight: 24
} as const;

const SUBSECTION_ADD_SX = { minHeight: 24, py: 0, mr: -1 } as const;
/** A card without a known limit still has XIOM slots x1 and x2 */
const DEFAULT_XIOM_SLOTS = 2;
const MDA_ROW_SX = {
  display: "grid",
  gridTemplateColumns: "92px minmax(0, 1fr) 28px",
  gap: 1,
  alignItems: "flex-start"
} as const;
const XIOM_ROW_SX = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 28px",
  gap: 1,
  alignItems: "flex-start"
} as const;
const REMOVE_CELL_SX = { display: "flex", justifyContent: "center", pt: "3px" } as const;
const ELLIPSIS_SX = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
/** On a slot's row the outline stays out of the way until the field is in use */
const ROW_FIELD_SX = { "& .MuiOutlinedInput-notchedOutline": { borderColor: "transparent" } } as const;
/** A catalog mismatch is advice, not an error: containerlab deploys it anyway */
const WARNING_FIELD_SX = {
  "& .MuiFormHelperText-root": { color: "warning.main" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "warning.main" }
} as const;

function replaceAt<T>(items: T[], index: number, updates: Partial<T>): T[] {
  return items.map((item, position) => (position === index ? { ...item, ...updates } : item));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, position) => position !== index);
}

/** The types to offer: the chassis' list when the catalog has one, else every known type */
export function offeredTypes(listed: string[] | undefined, known: string[]): string[] {
  return listed !== undefined && listed.length > 0 ? listed : known;
}

export type IssueAt = (target: HardwareTarget) => string | undefined;

export const TypeField: React.FC<{
  id: string;
  label: string;
  value: string;
  types: string[];
  issue?: string;
  hint?: string;
  placeholder?: string;
  /** Sits on a slot's row, where a visible label would repeat on every line */
  inRow?: boolean;
  onChange: (type: string) => void;
}> = ({ id, label, value, types, issue, hint, placeholder, inRow = false, onChange }) => (
  <Box sx={[issue !== undefined && WARNING_FIELD_SX, inRow && ROW_FIELD_SX]}>
    <FilterableDropdown
      id={id}
      label={inRow ? undefined : label}
      ariaLabel={inRow ? label : undefined}
      value={value}
      onChange={onChange}
      options={types.map((type) => ({ value: type, label: type }))}
      allowFreeText
      showArrow
      placeholder={placeholder}
      helperText={issue ?? hint}
    />
  </Box>
);

const RemoveButton: React.FC<{ label: string; title: string; onClick: () => void }> = ({
  label,
  title,
  onClick
}) => (
  <Box sx={REMOVE_CELL_SX}>
    <IconButton size="small" onClick={onClick} aria-label={label} title={title} sx={REMOVE_BUTTON_SX}>
      <DeleteIcon sx={ROW_ICON_SX} />
    </IconButton>
  </Box>
);

const Subsection: React.FC<{
  title: string;
  addLabel: string;
  addDisabled?: boolean;
  addTitle?: string;
  onAdd: () => void;
  children?: React.ReactNode;
}> = ({ title, addLabel, addDisabled = false, addTitle, onAdd, children }) => (
  <Box>
    <Box sx={HEADER_ROW_SX}>
      <Typography variant="subtitle2">{title}</Typography>
      {/* On the wrapper: a disabled button takes no pointer events, so it could not say why */}
      <Box component="span" title={addTitle}>
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={addDisabled}
          sx={SUBSECTION_ADD_SX}
        >
          {addLabel}
        </Button>
      </Box>
    </Box>
    {React.Children.toArray(children).length > 0 && <Box sx={{ ...COLUMN_SX, pt: 1.5 }}>{children}</Box>}
  </Box>
);

const MdaRow: React.FC<{
  idPrefix: string;
  mda: SrosMda;
  types: string[];
  /** Port path this MDA hangs off, such as 1/x1/ */
  prefix: string;
  issue?: string;
  onUpdate: (updates: Partial<SrosMda>) => void;
  onRemove: () => void;
}> = ({ idPrefix, mda, types, prefix, issue, onUpdate, onRemove }) => (
  <Box sx={MDA_ROW_SX}>
    <TextField
      id={`${idPrefix}-slot`}
      label="MDA"
      type="number"
      size="small"
      fullWidth
      value={String(mda.slot ?? "")}
      onChange={(event) =>
        onUpdate({ slot: event.target.value ? parseInt(event.target.value, 10) : undefined })
      }
      slotProps={{
        htmlInput: { min: 1 },
        input:
          prefix === ""
            ? undefined
            : { startAdornment: <InputAdornment position="start">{prefix}</InputAdornment> }
      }}
    />
    <TypeField
      id={`${idPrefix}-type`}
      label="Type"
      value={mda.type ?? ""}
      types={types}
      issue={issue}
      onChange={(type) => onUpdate({ type })}
    />
    <RemoveButton label={`Remove MDA ${mda.slot ?? ""}`} title="Remove MDA" onClick={onRemove} />
  </Box>
);

/** An MDA that comes with the chassis: shown so the slot numbers make sense, never written */
const FixedMdaRow: React.FC<{ slot: number; type: string; prefix: string }> = ({ slot, type, prefix }) => (
  <Box
    data-testid={`fixed-mda-${slot}`}
    title="Comes with the chassis"
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      minHeight: 32,
      px: 1,
      border: 1,
      borderColor: "divider",
      borderRadius: controlRadius,
      fontSize: 12
    }}
  >
    <Box component="span" sx={{ flexShrink: 0, color: "text.secondary" }}>
      {prefix}
      {slot}
    </Box>
    <Box component="span" sx={{ ...ELLIPSIS_SX, flex: 1, minWidth: 0 }}>
      {type}
    </Box>
    <Box
      component="span"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0, color: "text.secondary" }}
    >
      <LockIcon sx={{ fontSize: 14 }} aria-hidden />
      Fixed
    </Box>
  </Box>
);

export const MdaSection: React.FC<{
  idPrefix: string;
  mdas: SrosMda[];
  types: string[];
  fixedMdas?: Readonly<Partial<Record<number, string>>>;
  prefix: string;
  issueOf: (index: number) => string | undefined;
  onChange: (mdas: SrosMda[]) => void;
  /** New MDAs start on this type, when the list is the chassis' own */
  defaultType?: string;
  /** The highest slot the hardware has for this list, and how to say so once it is full */
  limit?: { highest: number; note: string | undefined };
  /** XIOMs of an XCM: they hold the same slots as its MDAs */
  xcmXioms?: SrosXiom[];
}> = ({ idPrefix, mdas, types, fixedMdas = {}, prefix, issueOf, onChange, defaultType, limit, xcmXioms }) => {
  const taken = new Set(mdas.map((mda) => mda.slot));
  const fixedRows = Object.entries(fixedMdas).flatMap(([slot, type]) =>
    type === undefined || taken.has(Number(slot)) ? [] : [{ slot: Number(slot), type }]
  );
  const slot = nextMdaSlot(mdas, fixedMdas, xcmXioms);
  const isFull = limit !== undefined && slot > limit.highest;
  const addMda = (): void => {
    onChange([...mdas, defaultType === undefined ? { slot } : { slot, type: defaultType }]);
  };
  return (
    <Subsection
      title="MDAs"
      addLabel="Add MDA"
      addDisabled={isFull}
      addTitle={isFull ? limit.note : undefined}
      onAdd={addMda}
    >
      {mdas.map((mda, index) => (
        <MdaRow
          key={index}
          idPrefix={`${idPrefix}-${index}`}
          mda={mda}
          types={types}
          prefix={prefix}
          issue={issueOf(index)}
          onUpdate={(updates) => onChange(replaceAt(mdas, index, updates))}
          onRemove={() => onChange(removeAt(mdas, index))}
        />
      ))}
      {fixedRows.map(({ slot, type }) => (
        <FixedMdaRow key={slot} slot={slot} type={type} prefix={prefix} />
      ))}
    </Subsection>
  );
};

const XiomBlock: React.FC<{
  idPrefix: string;
  xiom: SrosXiom;
  xiomIndex: number;
  componentIndex: number;
  slotLabel: string;
  types: string[];
  mdaTypes: string[];
  issueAt: IssueAt;
  onUpdate: (updates: Partial<SrosXiom>) => void;
  onRemove: () => void;
}> = ({ idPrefix, xiom, xiomIndex, componentIndex, slotLabel, types, mdaTypes, issueAt, onUpdate, onRemove }) => {
  const slot = xiom.slot ?? xiomIndex + 1;
  return (
    <Box
      data-testid={`xiom-${slot}`}
      sx={{ ...COLUMN_SX, p: 1.5, border: 1, borderColor: "divider", borderRadius: controlRadius }}
    >
      <Box sx={XIOM_ROW_SX}>
        <TypeField
          id={`${idPrefix}-type`}
          label={`XIOM x${slot}`}
          value={xiom.type ?? ""}
          types={types}
          issue={issueAt({ kind: "xiom", component: componentIndex, xiom: xiomIndex })}
          onChange={(type) => onUpdate({ type })}
        />
        <RemoveButton label={`Remove XIOM x${slot}`} title="Remove XIOM" onClick={onRemove} />
      </Box>
      <MdaSection
        idPrefix={`${idPrefix}-mda`}
        mdas={xiom.mda ?? []}
        types={mdaTypes}
        prefix={`${slotLabel}/x${slot}/`}
        limit={{ highest: XIOM_MDA_SLOTS, note: XIOM_MDA_NOTE }}
        issueOf={(mda) => issueAt({ kind: "mda", component: componentIndex, xiom: xiomIndex, mda })}
        onChange={(mda) => onUpdate({ mda })}
      />
    </Box>
  );
};

export const XiomSection: React.FC<{
  idPrefix: string;
  xioms: SrosXiom[];
  componentIndex: number;
  slotLabel: string;
  /** The chassis' XIOM types; empty when the catalog does not know it */
  listedTypes: string[];
  knownTypes: SrosComponentTypes;
  issueAt: IssueAt;
  onChange: (xioms: SrosXiom[]) => void;
  /** The slots an XCM has, its MDAs in them, and how to say so; undefined without a known limit */
  xcm?: { slots: number; mdas: SrosMda[]; note: string | undefined };
}> = ({ idPrefix, xioms, componentIndex, slotLabel, listedTypes, knownTypes, issueAt, onChange, xcm }) => {
  const slot = nextXiomSlot(xioms, xcm?.mdas);
  const isFull = slot > (xcm?.slots ?? DEFAULT_XIOM_SLOTS);
  const fullNote = xcm === undefined ? "XIOM slots x1 and x2 are in use" : xcm.note;
  const addXiom = (): void => {
    const type = listedTypes.at(0);
    onChange([...xioms, type === undefined ? { slot } : { slot, type }]);
  };
  return (
    <Subsection
      title="XIOMs"
      addLabel="Add XIOM"
      addDisabled={isFull}
      addTitle={isFull ? fullNote : undefined}
      onAdd={addXiom}
    >
      {xioms.map((xiom, xiomIndex) => (
        <XiomBlock
          key={xiomIndex}
          idPrefix={`${idPrefix}-${xiomIndex}`}
          xiom={xiom}
          xiomIndex={xiomIndex}
          componentIndex={componentIndex}
          slotLabel={slotLabel}
          types={offeredTypes(listedTypes, knownTypes.xiom)}
          mdaTypes={knownTypes.xiomMda}
          issueAt={issueAt}
          onUpdate={(updates) => onChange(replaceAt(xioms, xiomIndex, updates))}
          onRemove={() => onChange(removeAt(xioms, xiomIndex))}
        />
      ))}
    </Subsection>
  );
};
