import { Doc } from "../_generated/dataModel";
import { lineNet, lineTax } from "./util";

/** Lines that count towards the total: required lines, plus optional lines the client selected. */
export const included = (l: Doc<"quoteLineItems">) => !l.optional || l.selected;

export function quoteTotals(lines: Doc<"quoteLineItems">[]) {
  let gross = 0, net = 0, tax = 0;
  for (const l of lines.filter(included)) {
    gross += Math.round(l.quantity * l.unitPrice);
    net += lineNet(l);
    tax += lineTax(l);
  }
  return { subtotal: gross, discountTotal: gross - net, taxTotal: tax, total: net + tax };
}

export const formatMoney = (pence: number, currency = "GBP") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
