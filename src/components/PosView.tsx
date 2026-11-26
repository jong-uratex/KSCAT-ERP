import { useEffect, useState } from 'react';
import { Barcode, CreditCard, Minus, Plus, Printer, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency } from '../lib/format';
import type { BankAccount, PermissionMap, ProductItem, ThirdParty, Warehouse } from '../types/erp';
import { Modal } from './Modal';

interface PosViewProps {
  permissions: PermissionMap;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

interface CartEntry {
  product: ProductItem;
  qty: number;
}

interface PosReceipt {
  ref: string;
  totalTtc: number;
  subtotalHt: number;
  taxTotal: number;
  paymentMethod: string;
  date: string;
  lines: Array<{ ref: string; label: string; qty: number; unitPrice: number; taxRate: number }>;
}

export function PosView({ permissions, onNotify }: PosViewProps) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [customers, setCustomers] = useState<ThirdParty[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [selectedWhId, setSelectedWhId] = useState('');
  const [selectedAccId, setSelectedAccId] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Card Terminal');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);

  const canCheckout = can(permissions, 'pos', 'write');

  async function loadPosData() {
    try {
      const [prodRes, tpRes, bankRes] = await Promise.all([
        apiRequest<{ products: ProductItem[]; warehouses: Warehouse[] }>('/api/products'),
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
        apiRequest<{ accounts: BankAccount[] }>('/api/bank-accounts'),
      ]);
      setProducts(prodRes.products);
      setWarehouses(prodRes.warehouses);
      setCustomers(tpRes.thirdParties.filter((t) => t.party_type !== 'supplier'));
      setAccounts(bankRes.accounts);
      if (prodRes.warehouses[0] && !selectedWhId) setSelectedWhId(String(prodRes.warehouses[0].id));
      if (bankRes.accounts[0] && !selectedAccId) setSelectedAccId(String(bankRes.accounts[0].id));
      const cust = tpRes.thirdParties.find((t) => t.party_type !== 'supplier');
      if (cust && !selectedPartyId) setSelectedPartyId(String(cust.id));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load POS catalog.', 'error');
    }
  }

  useEffect(() => {
    loadPosData();
  }, []);

  function addToCart(product: ProductItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) {
        return prev.map((c) => (c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { product, qty: 1 }];
    });
  }

  function updateQty(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.product.id === productId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  }

  const filteredProducts = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.ref.toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
  });

  const totals = cart.reduce(
    (acc, item) => {
      const ht = item.qty * item.product.sell_price;
      const tax = ht * (item.product.tax_rate / 100);
      return { ht: acc.ht + ht, tax: acc.tax + tax, ttc: acc.ttc + ht + tax };
    },
    { ht: 0, tax: 0, ttc: 0 }
  );

  async function handleCheckout() {
    if (!canCheckout || cart.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<PosReceipt>('/api/pos/checkout', {
        method: 'POST',
        body: {
          thirdPartyId: selectedPartyId ? Number(selectedPartyId) : null,
          warehouseId: Number(selectedWhId),
          bankAccountId: Number(selectedAccId),
          paymentMethod,
          items: cart.map((c) => ({ productId: c.product.id, qty: c.qty })),
        },
      });
      setReceipt(res);
      setCart([]);
      onNotify(`POS Sale ${res.ref} settled (${formatCurrency(res.totalTtc)}).`);
      await loadPosData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Checkout failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Catalog & Barcode Scanner */}
      <div className="lg:col-span-7 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim()) {
                  const exact = products.find(
                    (p) =>
                      p.barcode?.toLowerCase() === search.trim().toLowerCase() ||
                      p.ref.toLowerCase() === search.trim().toLowerCase()
                  );
                  if (exact) {
                    addToCart(exact);
                    setSearch('');
                  }
                }
              }}
              placeholder="Scan barcode, enter SKU ref, or search catalog..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            />
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-500 px-2">
            <Barcode className="w-4 h-4" />
            <span>Press Enter on exact barcode</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addToCart(p)}
              className="text-left p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-orange-600 transition-colors flex flex-col justify-between gap-2"
            >
              <div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-orange-700 dark:text-orange-400">{p.ref}</span>
                  <span className="text-zinc-400">
                    {p.product_type === 'service' ? 'Service' : `Stock: ${p.total_stock}`}
                  </span>
                </div>
                <div className="mt-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2">
                  {p.name}
                </div>
              </div>
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <span className="font-mono tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(p.sell_price)}
                </span>
                <span className="text-[11px] font-mono text-zinc-400">+{p.tax_rate}% VAT</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right TakePOS Register */}
      <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <ShoppingBag className="w-4 h-4 text-orange-700 dark:text-orange-400" />
              <span>TakePOS Terminal</span>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="text-xs text-zinc-500 hover:text-red-600"
              >
                Clear Cart
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Customer</label>
              <select
                value={selectedPartyId}
                onChange={(e) => setSelectedPartyId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Stock Warehouse</label>
              <select
                value={selectedWhId}
                onChange={(e) => setSelectedWhId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.ref} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Cash / Bank Drawer</label>
              <select
                value={selectedAccId}
                onChange={(e) => setSelectedAccId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="Card Terminal">Card Terminal (EMV)</option>
                <option value="Cash Drawer">Cash Drawer</option>
                <option value="Stripe POS">Stripe Terminal</option>
                <option value="PayPal QR">PayPal QR</option>
              </select>
            </div>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-72 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                Select products from the grid or scan a barcode to start a receipt.
              </div>
            ) : (
              cart.map((entry) => (
                <div key={entry.product.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {entry.product.name}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500">
                      {formatCurrency(entry.product.sell_price)} × {entry.qty}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQty(entry.product.id, -1)}
                      className="p-1 rounded border border-zinc-200 dark:border-zinc-700"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono text-xs">{entry.qty}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(entry.product.id, 1)}
                      className="p-1 rounded border border-zinc-200 dark:border-zinc-700"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateQty(entry.product.id, -entry.qty)}
                      className="p-1 text-zinc-400 hover:text-red-600 ml-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal (HT)</span>
              <span>{formatCurrency(totals.ht)}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>VAT Tax</span>
              <span>{formatCurrency(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
              <span>Total Due (TTC)</span>
              <span>{formatCurrency(totals.ttc)}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={!canCheckout || cart.length === 0 || submitting}
            onClick={handleCheckout}
            className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
          >
            <CreditCard className="w-4 h-4" />
            <span>{submitting ? 'Processing Checkout...' : `Settle Receipt (${formatCurrency(totals.ttc)})`}</span>
          </button>
        </div>
      </div>

      {/* Receipt Modal */}
      <Modal
        open={Boolean(receipt)}
        onClose={() => setReceipt(null)}
        title={receipt ? `TakePOS Receipt — ${receipt.ref}` : ''}
      >
        {receipt && (
          <div className="space-y-4 font-mono text-xs">
            <div className="text-center border-b border-dashed border-zinc-300 dark:border-zinc-700 pb-3 space-y-1">
              <div className="inline-flex items-center justify-center gap-2">
                <img
                  src="/assets/aistudio/favicon_1e6abf50.png"
                  alt=""
                  aria-hidden="true"
                  className="w-5 h-5 object-contain"
                />
                <span className="text-sm font-bold">KSCAT-ERP · RETAIL POS</span>
              </div>
              <div className="text-zinc-500">
                {receipt.date} · {receipt.paymentMethod}
              </div>
            </div>
            <div className="space-y-1.5">
              {receipt.lines.map((l, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {l.qty}x {l.label}
                  </span>
                  <span>{formatCurrency(l.qty * l.unitPrice)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-zinc-300 dark:border-zinc-700 pt-3 space-y-1">
              <div className="flex justify-between text-zinc-500">
                <span>Subtotal (HT)</span>
                <span>{formatCurrency(receipt.subtotalHt)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>VAT</span>
                <span>{formatCurrency(receipt.taxTotal)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span>PAID TOTAL</span>
                <span>{formatCurrency(receipt.totalTtc)}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 font-sans">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
