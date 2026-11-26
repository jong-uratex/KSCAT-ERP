import { useEffect, useState } from 'react';
import { ArrowRight, PackageCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency, formatDate, formatDateTime } from '../lib/format';
import type { DashboardPayload } from '../types/erp';
import { StatusText } from './StatusText';

interface DashboardViewProps {
  onNavigate: (moduleKey: string) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<DashboardPayload>('/api/dashboard')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  const maxFlow = Math.max(
    1000,
    ...data.cashflowSeries.flatMap((m) => [m.inflow, m.outflow])
  );

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Treasury Cash Balance
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(data.kpis.cashBalance)}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Active checking, reserve & cash boxes
          </div>
        </div>

        <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Open Customer Receivables
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(data.kpis.openReceivables)}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Total billed: {formatCurrency(data.kpis.totalBilled)}
          </div>
        </div>

        <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Open Proposals Pipeline
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(data.kpis.openProposalsValue)}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {data.kpis.openProposalsCount} active commercial quote(s)
          </div>
        </div>

        <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Supplier Payables Due
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(data.kpis.openPayables)}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {data.lowStock.length} SKU(s) below min stock threshold
          </div>
        </div>
      </div>

      {/* Main Middle Row: Cashflow Chart + Low Stock Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Treasury Cashflow Overview
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Recorded inflows vs outflows across bank accounts by month
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Open Treasury</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {data.cashflowSeries.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No bank transactions recorded yet. Record an invoice payment or treasury entry to populate cashflow.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-6 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-orange-600 inline-block" />
                  <span>Inflows (Credits)</span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-zinc-400 dark:bg-zinc-600 inline-block" />
                  <span>Outflows (Debits)</span>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 items-end pt-2 h-48 border-b border-zinc-200 dark:border-zinc-800 pb-3">
                {data.cashflowSeries.map((pt) => {
                  const inPct = Math.max(4, Math.round((pt.inflow / maxFlow) * 100));
                  const outPct = Math.max(4, Math.round((pt.outflow / maxFlow) * 100));
                  return (
                    <div key={pt.month} className="flex flex-col items-center h-full justify-end gap-2">
                      <div className="flex items-end gap-1.5 w-full justify-center h-36">
                        <div
                          title={`Inflow: ${formatCurrency(pt.inflow)}`}
                          style={{ height: `${inPct}%` }}
                          className="w-5 rounded-t bg-orange-600 transition-all"
                        />
                        <div
                          title={`Outflow: ${formatCurrency(pt.outflow)}`}
                          style={{ height: `${outPct}%` }}
                          className="w-5 rounded-t bg-zinc-300 dark:bg-zinc-700 transition-all"
                        />
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                        {pt.month}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Low Stock Alert Panel */}
        <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Stock Replenishment Alerts
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline whitespace-nowrap"
            >
              Inventory
            </button>
          </div>

          {data.lowStock.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <PackageCheck className="w-8 h-8 text-emerald-600 mb-2" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                All SKUs Nominal
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Every tracked physical product meets its minimum stock threshold.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.lowStock.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                      {item.ref} · Min {item.min_stock}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-semibold text-red-700 dark:text-red-400">
                      {item.total_stock}
                    </div>
                    <div className="text-[11px] text-zinc-500">in stock</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Grids: Pending Invoices + Open Proposals + Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Pending Invoices & Bills
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
            >
              View All
            </button>
          </div>
          {data.pendingInvoices.length === 0 ? (
            <p className="py-8 text-sm text-center text-zinc-500">No pending invoices.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="pb-2.5 font-medium">Ref</th>
                    <th className="pb-2.5 font-medium">Third Party</th>
                    <th className="pb-2.5 font-medium">Due</th>
                    <th className="pb-2.5 font-medium text-right">Balance</th>
                    <th className="pb-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.pendingInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="py-2.5 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {inv.ref}
                      </td>
                      <td className="py-2.5 text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[160px]">
                        {inv.party_name}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {formatDate(inv.due_date)}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(inv.total_ttc - inv.amount_paid)}
                      </td>
                      <td className="py-2.5 text-right">
                        <StatusText status={inv.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Recent Activity & Security Events
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
            >
              Audit Log
            </button>
          </div>
          {data.recentLogs.length === 0 ? (
            <p className="py-8 text-sm text-center text-zinc-500">No recent events.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.recentLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {log.action.replace(/_/g, ' ')}
                      {log.entity_ref ? ` · ${log.entity_ref}` : ''}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {log.user_email} — {log.details}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400 whitespace-nowrap shrink-0">
                    {formatDateTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
