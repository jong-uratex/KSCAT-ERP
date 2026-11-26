import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Barcode, Boxes, Layers, PackageCheck, Pencil, Plus, Search, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';
import type {
  PermissionMap,
  ProductItem,
  ProductLot,
  ProductVariant,
  SearchFocusHint,
  StockLevel,
  StockMovement,
  Warehouse,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface InventoryViewProps {
  permissions: PermissionMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

function renderBarcodeBars(code: string): number[] {
  const clean = code || '000000000000';
  const bars: number[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean.charCodeAt(i);
    bars.push((ch % 3) + 1, ((ch >> 2) % 2) + 1, ((ch >> 4) % 3) + 1);
  }
  return bars;
}

export function InventoryView({ permissions, focusHint, onNotify }: InventoryViewProps) {
  const [tab, setTab] = useState<'catalog' | 'warehouses' | 'lots' | 'variants' | 'movements'>('catalog');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [lots, setLots] = useState<ProductLot[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);

  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [warehouseModal, setWarehouseModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [stockModal, setStockModal] = useState(false);
  const [lotModal, setLotModal] = useState(false);
  const [editingLot, setEditingLot] = useState<ProductLot | null>(null);
  const [variantModal, setVariantModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [editingMovement, setEditingMovement] = useState<StockMovement | null>(null);
  const [movDocRef, setMovDocRef] = useState('');
  const [movReason, setMovReason] = useState('');
  const [barcodeProduct, setBarcodeProduct] = useState<ProductItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ endpoint: string; label: string; warning?: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Product form
  const [pRef, setPRef] = useState('');
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<'product' | 'service'>('product');
  const [pCategory, setPCategory] = useState('Hardware');
  const [pCost, setPCost] = useState('100');
  const [pSell, setPSell] = useState('220');
  const [pTax, setPTax] = useState('20');
  const [pMinStock, setPMinStock] = useState('10');
  const [pBarcode, setPBarcode] = useState('');
  const [pInitStock, setPInitStock] = useState('0');
  const [pWhId, setPWhId] = useState('');

  // Warehouse form
  const [wRef, setWRef] = useState('');
  const [wName, setWName] = useState('');
  const [wLocation, setWLocation] = useState('');
  const [wStatus, setWStatus] = useState<'active' | 'inactive'>('active');

  // Stock Movement form
  const [mProductId, setMProductId] = useState('');
  const [mWarehouseId, setMWarehouseId] = useState('');
  const [mTargetWhId, setMTargetWhId] = useState('');
  const [mType, setMType] = useState<'in' | 'out' | 'transfer' | 'adjustment'>('in');
  const [mQty, setMQty] = useState('10');
  const [mReason, setMReason] = useState('');

  // Lot form
  const [lProductId, setLProductId] = useState('');
  const [lWhId, setLWhId] = useState('');
  const [lNumber, setLNumber] = useState('');
  const [lSerial, setLSerial] = useState('');
  const [lQty, setLQty] = useState('10');
  const [lExpiry, setLExpiry] = useState('');
  const [lStatus, setLStatus] = useState<'available' | 'quarantine' | 'consumed'>('available');

  // Variant form
  const [vProductId, setVProductId] = useState('');
  const [vSuffix, setVSuffix] = useState('');
  const [vAttrName, setVAttrName] = useState('Color / Spec');
  const [vAttrVal, setVAttrVal] = useState('');
  const [vDelta, setVDelta] = useState('0');
  const [vStock, setVStock] = useState('10');

  const canWrite = can(permissions, 'products', 'write');
  const canDelete = can(permissions, 'products', 'delete');
  const canAdjust = can(permissions, 'products', 'adjust_stock');

  async function loadInventory() {
    setLoading(true);
    try {
      const [res, ext] = await Promise.all([
        apiRequest<{
          products: ProductItem[];
          warehouses: Warehouse[];
          stockLevels: StockLevel[];
          movements: StockMovement[];
        }>('/api/products'),
        apiRequest<{ lots: ProductLot[]; variants: ProductVariant[] }>('/api/product-extensions'),
      ]);
      setProducts(res.products);
      setWarehouses(res.warehouses);
      setStockLevels(res.stockLevels);
      setMovements(res.movements);
      setLots(ext.lots);
      setVariants(ext.variants);

      const physical = res.products.filter((p) => p.product_type === 'product');
      if (physical.length > 0) {
        if (!mProductId) setMProductId(String(physical[0].id));
        if (!lProductId) setLProductId(String(physical[0].id));
        if (!vProductId) setVProductId(String(physical[0].id));
      }
      if (res.warehouses.length > 0) {
        if (!pWhId) setPWhId(String(res.warehouses[0].id));
        if (!mWarehouseId) setMWarehouseId(String(res.warehouses[0].id));
        if (!lWhId) setLWhId(String(res.warehouses[0].id));
        if (!mTargetWhId && res.warehouses[1]) setMTargetWhId(String(res.warehouses[1].id));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load inventory.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  useEffect(() => {
    if (!focusHint) return;
    setTab('catalog');
    setSearch(focusHint.ref);
  }, [focusHint?.ts]);

  function openCreateProduct() {
    setEditingProduct(null);
    setPRef('');
    setPName('');
    setPType('product');
    setPCategory('Hardware');
    setPCost('100');
    setPSell('220');
    setPTax('20');
    setPMinStock('10');
    setPBarcode('');
    setPInitStock('0');
    if (warehouses[0]) setPWhId(String(warehouses[0].id));
    setProductModal(true);
  }

  function openEditProduct(p: ProductItem) {
    setEditingProduct(p);
    setPRef(p.ref);
    setPName(p.name);
    setPType(p.product_type);
    setPCategory(p.category);
    setPCost(String(p.cost_price));
    setPSell(String(p.sell_price));
    setPTax(String(p.tax_rate));
    setPMinStock(String(p.min_stock));
    setPBarcode(p.barcode);
    setProductModal(true);
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingProduct) {
        await apiRequest(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: {
            name: pName,
            productType: pType,
            category: pCategory,
            costPrice: Number(pCost),
            sellPrice: Number(pSell),
            taxRate: Number(pTax),
            minStock: Number(pMinStock),
            barcode: pBarcode,
          },
        });
        onNotify(`Updated ${editingProduct.ref}.`);
      } else {
        await apiRequest('/api/products', {
          method: 'POST',
          body: {
            ref: pRef,
            name: pName,
            productType: pType,
            category: pCategory,
            costPrice: Number(pCost),
            sellPrice: Number(pSell),
            taxRate: Number(pTax),
            minStock: Number(pMinStock),
            barcode: pBarcode,
            initialStock: Number(pInitStock),
            warehouseId: pWhId ? Number(pWhId) : undefined,
          },
        });
        onNotify('Product / service added to catalog.');
      }
      setProductModal(false);
      setEditingProduct(null);
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save product.', 'error');
    }
  }

  function openCreateWarehouse() {
    setEditingWarehouse(null);
    setWRef('');
    setWName('');
    setWLocation('');
    setWStatus('active');
    setWarehouseModal(true);
  }

  function openEditWarehouse(w: Warehouse) {
    setEditingWarehouse(w);
    setWRef(w.ref);
    setWName(w.name);
    setWLocation(w.location);
    setWStatus(w.status);
    setWarehouseModal(true);
  }

  async function handleSaveWarehouse(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingWarehouse) {
        await apiRequest(`/api/warehouses/${editingWarehouse.id}`, {
          method: 'PUT',
          body: { name: wName, location: wLocation, status: wStatus },
        });
        onNotify(`Updated warehouse ${editingWarehouse.ref}.`);
      } else {
        await apiRequest('/api/warehouses', {
          method: 'POST',
          body: { ref: wRef, name: wName, location: wLocation },
        });
        onNotify('Warehouse created.');
      }
      setWarehouseModal(false);
      setEditingWarehouse(null);
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save warehouse.', 'error');
    }
  }

  async function handleStockMovement(e: FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/stock-movements', {
        method: 'POST',
        body: {
          productId: Number(mProductId),
          warehouseId: Number(mWarehouseId),
          targetWarehouseId: mType === 'transfer' ? Number(mTargetWhId) : undefined,
          movementType: mType,
          quantity: Number(mQty),
          reason: mReason,
        },
      });
      setStockModal(false);
      setMReason('');
      onNotify('Stock movement recorded.');
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Stock adjustment failed.', 'error');
    }
  }

  async function handleSaveMovementNote(e: FormEvent) {
    e.preventDefault();
    if (!editingMovement) return;
    try {
      await apiRequest(`/api/stock-movements/${editingMovement.id}`, {
        method: 'PUT',
        body: { docRef: movDocRef, reason: movReason },
      });
      setEditingMovement(null);
      onNotify('Stock movement note updated.');
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update movement.', 'error');
    }
  }

  function openCreateLot() {
    setEditingLot(null);
    const physical = products.filter((p) => p.product_type === 'product');
    if (physical[0]) setLProductId(String(physical[0].id));
    if (warehouses[0]) setLWhId(String(warehouses[0].id));
    setLNumber('');
    setLSerial('');
    setLQty('10');
    setLExpiry('');
    setLStatus('available');
    setLotModal(true);
  }

  function openEditLot(l: ProductLot) {
    setEditingLot(l);
    setLProductId(String(l.product_id));
    setLWhId(String(l.warehouse_id));
    setLNumber(l.lot_number);
    setLSerial(l.serial_number);
    setLQty(String(l.quantity));
    setLExpiry(l.expiry_date);
    setLStatus(l.status);
    setLotModal(true);
  }

  async function handleSaveLot(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        productId: Number(lProductId),
        warehouseId: Number(lWhId),
        lotNumber: lNumber,
        serialNumber: lSerial,
        quantity: Number(lQty) || 0,
        expiryDate: lExpiry,
        status: lStatus,
      };
      if (editingLot) {
        await apiRequest(`/api/product-lots/${editingLot.id}`, { method: 'PUT', body });
        onNotify(`Updated lot ${lNumber}.`);
      } else {
        await apiRequest('/api/product-lots', { method: 'POST', body });
        onNotify('Batch / Lot registered.');
      }
      setLotModal(false);
      setEditingLot(null);
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save lot.', 'error');
    }
  }

  function openCreateVariant() {
    setEditingVariant(null);
    const physical = products.filter((p) => p.product_type === 'product');
    if (physical[0]) setVProductId(String(physical[0].id));
    setVSuffix('');
    setVAttrName('Color / Spec');
    setVAttrVal('');
    setVDelta('0');
    setVStock('10');
    setVariantModal(true);
  }

  function openEditVariant(v: ProductVariant) {
    setEditingVariant(v);
    setVProductId(String(v.product_id));
    setVSuffix(v.sku_suffix);
    setVAttrName(v.attribute_name);
    setVAttrVal(v.attribute_value);
    setVDelta(String(v.price_delta));
    setVStock(String(v.stock_qty));
    setVariantModal(true);
  }

  async function handleSaveVariant(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        productId: Number(vProductId),
        skuSuffix: vSuffix,
        attributeName: vAttrName,
        attributeValue: vAttrVal,
        priceDelta: Number(vDelta) || 0,
        stockQty: Number(vStock) || 0,
      };
      if (editingVariant) {
        await apiRequest(`/api/product-variants/${editingVariant.id}`, { method: 'PUT', body });
        onNotify('Product variant updated.');
      } else {
        await apiRequest('/api/product-variants', { method: 'POST', body });
        onNotify('Product variant created.');
      }
      setVariantModal(false);
      setEditingVariant(null);
      await loadInventory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save variant.', 'error');
    }
  }

  function promptDelete(endpoint: string, label: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ endpoint, label, warning });
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.endpoint, { method: 'DELETE' });
      onNotify(`${deleteTarget.label} deleted.`);
      setDeleteTarget(null);
      await loadInventory();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.ref.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode ?? '').toLowerCase().includes(search.toLowerCase())
  );

  function getWarehouseStock(productId: number, warehouseId: number): number {
    return stockLevels.find((s) => s.product_id === productId && s.warehouse_id === warehouseId)?.quantity ?? 0;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'catalog' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Catalog & Barcodes ({products.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('warehouses')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'warehouses' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <WarehouseIcon className="w-3.5 h-3.5" />
            <span>Warehouses ({warehouses.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('lots')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'lots' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>Lots & Serials ({lots.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('variants')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'variants' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Variants ({variants.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'movements' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Movements</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {tab === 'catalog' && (
            <div className="relative flex-1 md:w-56">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, barcode, name..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              />
            </div>
          )}

          {canAdjust && (
            <button
              type="button"
              onClick={() => setStockModal(true)}
              className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              Adjust / Transfer Stock
            </button>
          )}

          {canWrite && tab === 'warehouses' && (
            <button
              type="button"
              onClick={openCreateWarehouse}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Warehouse</span>
            </button>
          )}
          {canWrite && tab === 'lots' && (
            <button
              type="button"
              onClick={openCreateLot}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Lot / Serial</span>
            </button>
          )}
          {canWrite && tab === 'variants' && (
            <button
              type="button"
              onClick={openCreateVariant}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Variant</span>
            </button>
          )}
          {canWrite && (tab === 'catalog' || tab === 'movements') && (
            <button
              type="button"
              onClick={openCreateProduct}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Product / Service</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading inventory...</div>
        ) : tab === 'catalog' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500 dark:text-zinc-400">
                  <th className="py-3 px-4 font-medium">SKU</th>
                  <th className="py-3 px-4 font-medium">Item Name</th>
                  <th className="py-3 px-4 font-medium">Barcode (EAN-13)</th>
                  <th className="py-3 px-4 font-medium">Category</th>
                  <th className="py-3 px-4 font-medium text-right">Cost</th>
                  <th className="py-3 px-4 font-medium text-right">Selling Price</th>
                  <th className="py-3 px-4 font-medium text-right">Stock</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredProducts.map((p) => {
                  const isLow = p.product_type === 'product' && p.total_stock < p.min_stock;
                  return (
                    <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">{p.ref}</td>
                      <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{p.name}</td>
                      <td className="py-3 px-4">
                        {p.barcode ? (
                          <button
                            type="button"
                            onClick={() => setBarcodeProduct(p)}
                            className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400"
                          >
                            <Barcode className="w-3.5 h-3.5" />
                            <span>{p.barcode}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 capitalize">{p.product_type} · {p.category}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-zinc-600 dark:text-zinc-400">{formatCurrency(p.cost_price)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">{formatCurrency(p.sell_price)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">
                        {p.product_type === 'service' ? (
                          <span className="text-zinc-400">Service</span>
                        ) : (
                          <span className={isLow ? 'text-red-700 dark:text-red-400 font-semibold' : 'text-zinc-900 dark:text-zinc-100'}>
                            {p.total_stock} {isLow ? `(Min ${p.min_stock})` : ''}
                          </span>
                        )}
                      </td>
                      {(canWrite || canDelete) && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openEditProduct(p)}
                                title="Edit product"
                                aria-label={`Edit ${p.name}`}
                                className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  promptDelete(
                                    `/api/products/${p.id}`,
                                    `${p.ref} (${p.name})`,
                                    'Products referenced by active BOMs or manufacturing orders cannot be deleted.'
                                  )
                                }
                                title="Delete product"
                                aria-label={`Delete ${p.name}`}
                                className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : tab === 'warehouses' ? (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {warehouses.map((wh) => {
                const totalUnits = stockLevels.filter((s) => s.warehouse_id === wh.id).reduce((acc, s) => acc + s.quantity, 0);
                return (
                  <div key={wh.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-mono text-orange-700 dark:text-orange-400">{wh.ref}</div>
                      {(canWrite || canDelete) && (
                        <div className="inline-flex items-center gap-1">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditWarehouse(wh)}
                              title="Edit warehouse"
                              aria-label={`Edit ${wh.name}`}
                              className="p-1 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                promptDelete(
                                  `/api/warehouses/${wh.id}`,
                                  `${wh.ref} (${wh.name})`,
                                  'Warehouses with remaining stock or linked orders cannot be deleted.'
                                )
                              }
                              title="Delete warehouse"
                              aria-label={`Delete ${wh.name}`}
                              className="p-1 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{wh.name}</span>
                      <StatusText status={wh.status} />
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{wh.location || 'No address specified'}</div>
                    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-between text-xs">
                      <span className="text-zinc-500">Units Stored</span>
                      <span className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">{totalUnits}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Product</th>
                    {warehouses.map((w) => <th key={w.id} className="py-2.5 px-4 font-medium text-right">{w.ref}</th>)}
                    <th className="py-2.5 px-4 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {products.filter((p) => p.product_type === 'product').map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="font-mono text-zinc-500 mr-2">{p.ref}</span>
                        {p.name}
                      </td>
                      {warehouses.map((w) => <td key={w.id} className="py-2.5 px-4 font-mono tabular-nums text-right">{getWarehouseStock(p.id, w.id)}</td>)}
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">{p.total_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : tab === 'lots' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Lot / Batch</th>
                  <th className="py-3 px-4 font-medium">Serial Range</th>
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Warehouse</th>
                  <th className="py-3 px-4 font-medium">Expiry</th>
                  <th className="py-3 px-4 font-medium text-right">Qty</th>
                  <th className="py-3 px-4 font-medium text-right">Status</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lots.map((l) => (
                  <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{l.lot_number}</td>
                    <td className="py-3 px-4 font-mono text-zinc-600 dark:text-zinc-400">{l.serial_number || '—'}</td>
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{l.product_ref} · {l.product_name}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">{l.warehouse_name}</td>
                    <td className="py-3 px-4 font-mono text-zinc-500">{l.expiry_date || 'No Expiry'}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold">{l.quantity}</td>
                    <td className="py-3 px-4 text-right"><StatusText status={l.status} /></td>
                    {(canWrite || canDelete) && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditLot(l)}
                              title="Edit lot"
                              aria-label={`Edit ${l.lot_number}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/product-lots/${l.id}`, `Lot ${l.lot_number}`)}
                              title="Delete lot"
                              aria-label={`Delete ${l.lot_number}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'variants' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Variant SKU</th>
                  <th className="py-3 px-4 font-medium">Base Product</th>
                  <th className="py-3 px-4 font-medium">Attribute</th>
                  <th className="py-3 px-4 font-medium">Value</th>
                  <th className="py-3 px-4 font-medium text-right">Effective Price</th>
                  <th className="py-3 px-4 font-medium text-right">Stock</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {variants.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{v.product_ref}-{v.sku_suffix}</td>
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{v.product_name}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">{v.attribute_name}</td>
                    <td className="py-3 px-4 font-medium text-zinc-800 dark:text-zinc-200">{v.attribute_value}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right">
                      {formatCurrency(v.base_sell_price + v.price_delta)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold">{v.stock_qty}</td>
                    {(canWrite || canDelete) && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditVariant(v)}
                              title="Edit variant"
                              aria-label={`Edit ${v.product_ref}-${v.sku_suffix}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/product-variants/${v.id}`, `${v.product_ref}-${v.sku_suffix}`)}
                              title="Delete variant"
                              aria-label={`Delete ${v.product_ref}-${v.sku_suffix}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Warehouse</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium text-right">Qty Change</th>
                  <th className="py-3 px-4 font-medium">Reference / Reason</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  {canAdjust && <th className="py-3 px-4 font-medium text-right">Note</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-4 font-mono text-zinc-500">{formatDateTime(m.created_at)}</td>
                    <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{m.product_ref} · {m.product_name}</td>
                    <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">{m.warehouse_name}</td>
                    <td className="py-2.5 px-4 capitalize text-zinc-600 dark:text-zinc-400">{m.movement_type}</td>
                    <td className={`py-2.5 px-4 font-mono tabular-nums text-right font-semibold ${m.quantity_delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                      {m.quantity_delta >= 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                    </td>
                    <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">{m.doc_ref ? `${m.doc_ref} — ` : ''}{m.reason}</td>
                    <td className="py-2.5 px-4 text-zinc-500">{m.created_by}</td>
                    {canAdjust && (
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMovement(m);
                            setMovDocRef(m.doc_ref);
                            setMovReason(m.reason);
                          }}
                          title="Edit movement note & reference"
                          aria-label={`Edit movement ${m.id}`}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Barcode Preview Modal */}
      <Modal
        open={Boolean(barcodeProduct)}
        onClose={() => setBarcodeProduct(null)}
        title={barcodeProduct ? `Barcode Label — ${barcodeProduct.ref}` : ''}
        subtitle={barcodeProduct?.name}
      >
        {barcodeProduct && (
          <div className="space-y-4">
            <div className="p-6 rounded-lg border border-zinc-200 bg-white text-zinc-950 flex flex-col items-center">
              <div className="text-xs font-semibold mb-2">{barcodeProduct.name}</div>
              <svg viewBox="0 0 220 64" className="w-56 h-16" aria-label={`Barcode ${barcodeProduct.barcode}`}>
                {(() => {
                  const widths = renderBarcodeBars(barcodeProduct.barcode);
                  let x = 10;
                  return widths.map((w, idx) => {
                    const el = idx % 2 === 0 ? <rect key={idx} x={x} y={4} width={w * 1.8} height={46} fill="#0f172a" /> : null;
                    x += w * 1.9 + 1;
                    return el;
                  });
                })()}
              </svg>
              <div className="mt-1 font-mono text-sm tracking-widest">{barcodeProduct.barcode}</div>
              <div className="mt-2 text-xs font-mono text-zinc-500">SKU: {barcodeProduct.ref} · {formatCurrency(barcodeProduct.sell_price)}</div>
            </div>
          </div>
        )}
      </Modal>

      {/* New / Edit Product Modal */}
      <Modal
        open={productModal}
        onClose={() => {
          setProductModal(false);
          setEditingProduct(null);
        }}
        title={editingProduct ? `Edit Item — ${editingProduct.ref}` : 'New Product or Service'}
        subtitle={editingProduct ? 'Update catalog pricing, category, barcode, and stock thresholds.' : 'Register an item in the catalog with barcode and stock tracking.'}
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">SKU / Ref</label>
              <input type="text" required disabled={Boolean(editingProduct)} value={pRef} onChange={(e) => setPRef(e.target.value)} placeholder="PRD-1005" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
              <select value={pType} onChange={(e) => setPType(e.target.value as 'product' | 'service')} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="product">Physical Product</option>
                <option value="service">Service / License</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
              <input type="text" required value={pName} onChange={(e) => setPName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Category</label>
              <input type="text" value={pCategory} onChange={(e) => setPCategory(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Barcode (EAN-13 / UPC)</label>
              <input type="text" value={pBarcode} onChange={(e) => setPBarcode(e.target.value)} placeholder="3760024810099" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cost Price</label>
              <input type="number" step="0.01" value={pCost} onChange={(e) => setPCost(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Selling Price</label>
              <input type="number" step="0.01" value={pSell} onChange={(e) => setPSell(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">VAT Rate (%)</label>
              <input type="number" value={pTax} onChange={(e) => setPTax(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            {pType === 'product' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Min Stock Alert</label>
                  <input type="number" value={pMinStock} onChange={(e) => setPMinStock(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
                </div>
                {!editingProduct && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Initial Stock</label>
                      <input type="number" value={pInitStock} onChange={(e) => setPInitStock(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Initial Warehouse</label>
                      <select value={pWhId} onChange={(e) => setPWhId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.ref} — {w.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setProductModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingProduct ? 'Save Changes' : 'Save Item'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New / Edit Warehouse Modal */}
      <Modal
        open={warehouseModal}
        onClose={() => {
          setWarehouseModal(false);
          setEditingWarehouse(null);
        }}
        title={editingWarehouse ? `Edit Warehouse — ${editingWarehouse.ref}` : 'New Warehouse'}
        subtitle="Manage fulfillment depot details and status."
      >
        <form onSubmit={handleSaveWarehouse} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Warehouse Code</label>
            <input type="text" required disabled={Boolean(editingWarehouse)} value={wRef} onChange={(e) => setWRef(e.target.value)} placeholder="WH-SOUTH" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
            <input type="text" required value={wName} onChange={(e) => setWName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Location</label>
            <input type="text" value={wLocation} onChange={(e) => setWLocation(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          {editingWarehouse && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
              <select value={wStatus} onChange={(e) => setWStatus(e.target.value as 'active' | 'inactive')} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setWarehouseModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingWarehouse ? 'Save Changes' : 'Create Warehouse'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Stock Movement Modal */}
      <Modal open={stockModal} onClose={() => setStockModal(false)} title="Stock Adjustment or Transfer" subtitle="Record incoming inventory, write-offs, or warehouse transfers.">
        <form onSubmit={handleStockMovement} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Physical Product</label>
            <select required value={mProductId} onChange={(e) => setMProductId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
              {products.filter((p) => p.product_type === 'product').map((p) => (
                <option key={p.id} value={p.id}>{p.ref} — {p.name} (Total: {p.total_stock})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Movement Type</label>
              <select value={mType} onChange={(e) => setMType(e.target.value as typeof mType)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="in">Stock In (+)</option>
                <option value="out">Stock Out (-)</option>
                <option value="transfer">Warehouse Transfer</option>
                <option value="adjustment">Inventory Count (+)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Quantity</label>
              <input type="number" min={1} required value={mQty} onChange={(e) => setMQty(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">{mType === 'transfer' ? 'Source Warehouse' : 'Warehouse'}</label>
              <select required value={mWarehouseId} onChange={(e) => setMWarehouseId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.ref} — {w.name}</option>)}
              </select>
            </div>
            {mType === 'transfer' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destination Warehouse</label>
                <select required value={mTargetWhId} onChange={(e) => setMTargetWhId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.ref} — {w.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Reason</label>
            <input type="text" value={mReason} onChange={(e) => setMReason(e.target.value)} placeholder="e.g. Cycle count reconciliation" className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setStockModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Apply Movement</button>
          </div>
        </form>
      </Modal>

      {/* Register / Edit Lot Modal */}
      <Modal
        open={lotModal}
        onClose={() => {
          setLotModal(false);
          setEditingLot(null);
        }}
        title={editingLot ? `Edit Lot — ${editingLot.lot_number}` : 'Register Batch / Lot / Serials'}
        subtitle="Track lot traceability and expiration dates per warehouse."
      >
        <form onSubmit={handleSaveLot} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Product</label>
              <select required value={lProductId} onChange={(e) => setLProductId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {products.filter((p) => p.product_type === 'product').map((p) => <option key={p.id} value={p.id}>{p.ref} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Warehouse</label>
              <select required value={lWhId} onChange={(e) => setLWhId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Lot Number</label>
              <input type="text" required value={lNumber} onChange={(e) => setLNumber(e.target.value)} placeholder="LOT-26-B4" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Serial Range</label>
              <input type="text" value={lSerial} onChange={(e) => setLSerial(e.target.value)} placeholder="SN-100..150" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Quantity</label>
              <input type="number" min={0} value={lQty} onChange={(e) => setLQty(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Expiry Date (Optional)</label>
              <input type="date" value={lExpiry} onChange={(e) => setLExpiry(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            {editingLot && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Lot Status</label>
                <select value={lStatus} onChange={(e) => setLStatus(e.target.value as typeof lStatus)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                  <option value="available">Available</option>
                  <option value="quarantine">Quarantine</option>
                  <option value="consumed">Consumed</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setLotModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingLot ? 'Save Changes' : 'Register Lot'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New / Edit Variant Modal */}
      <Modal
        open={variantModal}
        onClose={() => {
          setVariantModal(false);
          setEditingVariant(null);
        }}
        title={editingVariant ? `Edit Variant — ${editingVariant.sku_suffix}` : 'Create Product Variant'}
        subtitle="Define SKU suffix, attribute option, and price differential."
      >
        <form onSubmit={handleSaveVariant} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Parent Product</label>
              <select required value={vProductId} onChange={(e) => setVProductId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {products.filter((p) => p.product_type === 'product').map((p) => <option key={p.id} value={p.id}>{p.ref} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">SKU Suffix</label>
              <input type="text" required value={vSuffix} onChange={(e) => setVSuffix(e.target.value)} placeholder="EU-24V" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Attribute Name</label>
              <input type="text" required value={vAttrName} onChange={(e) => setVAttrName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Attribute Value</label>
              <input type="text" required value={vAttrVal} onChange={(e) => setVAttrVal(e.target.value)} placeholder="DIN Rail Black" className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Price Delta ($)</label>
              <input type="number" step="0.01" value={vDelta} onChange={(e) => setVDelta(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Variant Stock</label>
              <input type="number" value={vStock} onChange={(e) => setVStock(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setVariantModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingVariant ? 'Save Changes' : 'Create Variant'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Stock Movement Note Modal */}
      <Modal
        open={Boolean(editingMovement)}
        onClose={() => setEditingMovement(null)}
        title="Edit Stock Movement Reference / Note"
        subtitle="Ledger quantities remain immutable to preserve warehouse stock balance integrity."
      >
        <form onSubmit={handleSaveMovementNote} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Document Reference</label>
            <input type="text" value={movDocRef} onChange={(e) => setMovDocRef(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Reason / Note</label>
            <input type="text" value={movReason} onChange={(e) => setMovReason(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditingMovement(null)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Note</button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemLabel={deleteTarget?.label ?? ''}
        warning={deleteTarget?.warning}
        loading={deleteLoading}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </div>
  );
}
