import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileSignature,
  FileText,
  PackagePlus,
  Pencil,
  Plus,
  Repeat,
  ShoppingCart,
  Target,
  Trash2,
  Truck,
  Wrench,
} from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  ContractItem,
  DocumentLine,
  EnabledModulesMap,
  InterventionItem,
  OpportunityItem,
  PermissionMap,
  ProductItem,
  Proposal,
  PurchaseOrder,
  SalesOrder,
  SearchFocusHint,
  ShipmentItem,
  SupplierRfq,
  ThirdParty,
  Warehouse,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface CommerceViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type CommerceTab =
  | 'opportunities'
  | 'proposals'
  | 'sales_orders'
  | 'contracts'
  | 'shipments'
  | 'interventions'
  | 'rfqs'
  | 'purchase_orders';

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

export function CommerceView({ permissions, enabledModules, focusHint, onNotify }: CommerceViewProps) {
  const canSalesRead = can(permissions, 'sales', 'read') && enabledModules.sales !== false;
  const canSalesWrite = can(permissions, 'sales', 'write');
  const canSalesValidate = can(permissions, 'sales', 'validate');
  const canSalesDelete = can(permissions, 'sales', 'delete');
  const canPurchRead = can(permissions, 'purchasing', 'read') && enabledModules.purchasing !== false;
  const canPurchWrite = can(permissions, 'purchasing', 'write');
  const canPurchValidate = can(permissions, 'purchasing', 'validate');
  const canPurchDelete = can(permissions, 'purchasing', 'delete');
  const canBillingWrite = can(permissions, 'billing', 'write');

  const [tab, setTab] = useState<CommerceTab>(canSalesRead ? 'proposals' : 'purchase_orders');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [shipments, setShipments] = useState<ShipmentItem[]>([]);
  const [interventions, setInterventions] = useState<InterventionItem[]>([]);
  const [rfqs, setRfqs] = useState<SupplierRfq[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  // Proposal / Order Create & Edit Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [docKind, setDocKind] = useState<'proposal' | 'sales_order' | 'purchase_order'>('proposal');
  const [editingDoc, setEditingDoc] = useState<
    | { kind: 'proposal'; record: Proposal }
    | { kind: 'sales_order'; record: SalesOrder }
    | { kind: 'purchase_order'; record: PurchaseOrder }
    | null
  >(null);
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [selectedWhId, setSelectedWhId] = useState('');
  const [docIncoterm, setDocIncoterm] = useState('EXW');
  const [docTitle, setDocTitle] = useState('');
  const [docDate, setDocDate] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([
    { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 },
  ]);

  // Online Signing Modal
  const [signModal, setSignModal] = useState<Proposal | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  // Opportunity Modal
  const [oppModal, setOppModal] = useState(false);
  const [editingOpp, setEditingOpp] = useState<OpportunityItem | null>(null);
  const [oppPartyId, setOppPartyId] = useState('');
  const [oppTitle, setOppTitle] = useState('');
  const [oppStage, setOppStage] = useState<OpportunityItem['stage']>('qualification');
  const [oppProb, setOppProb] = useState('35');
  const [oppAmount, setOppAmount] = useState('12000');
  const [oppCloseDate, setOppCloseDate] = useState('');

  // Contract Modal
  const [ctrModal, setCtrModal] = useState(false);
  const [editingCtr, setEditingCtr] = useState<ContractItem | null>(null);
  const [ctrPartyId, setCtrPartyId] = useState('');
  const [ctrTitle, setCtrTitle] = useState('');
  const [ctrCycle, setCtrCycle] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [ctrAmount, setCtrAmount] = useState('1450');
  const [ctrStatus, setCtrStatus] = useState<ContractItem['status']>('active');

  // Shipment Modal
  const [shipModal, setShipModal] = useState(false);
  const [editingShip, setEditingShip] = useState<ShipmentItem | null>(null);
  const [shipOrderId, setShipOrderId] = useState('');
  const [shipCarrier, setShipCarrier] = useState('DHL Freight');
  const [shipTracking, setShipTracking] = useState('');
  const [shipWeight, setShipWeight] = useState('12');
  const [shipDate, setShipDate] = useState('');
  const [shipStatus, setShipStatus] = useState<ShipmentItem['status']>('in_transit');

  // Intervention Modal
  const [intModal, setIntModal] = useState(false);
  const [editingInt, setEditingInt] = useState<InterventionItem | null>(null);
  const [intPartyId, setIntPartyId] = useState('');
  const [intTitle, setIntTitle] = useState('');
  const [intTech, setIntTech] = useState('');
  const [intHours, setIntHours] = useState('3');
  const [intDate, setIntDate] = useState('');
  const [intStatus, setIntStatus] = useState<InterventionItem['status']>('planned');

  // Supplier RFQ Modal
  const [rfqModal, setRfqModal] = useState(false);
  const [editingRfq, setEditingRfq] = useState<SupplierRfq | null>(null);
  const [rfqPartyId, setRfqPartyId] = useState('');
  const [rfqTitle, setRfqTitle] = useState('');
  const [rfqIncoterm, setRfqIncoterm] = useState('CIF');
  const [rfqProductId, setRfqProductId] = useState('');
  const [rfqQty, setRfqQty] = useState('25');
  const [rfqPrice, setRfqPrice] = useState('45');
  const [rfqDeadline, setRfqDeadline] = useState('');
  const [rfqStatus, setRfqStatus] = useState<SupplierRfq['status']>('open');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ endpoint: string; label: string; warning?: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function loadAll() {
    setLoading(true);
    try {
      const [tpRes, prodRes] = await Promise.all([
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
        apiRequest<{ products: ProductItem[]; warehouses: Warehouse[] }>('/api/products'),
      ]);
      setThirdParties(tpRes.thirdParties);
      setProducts(prodRes.products);
      setWarehouses(prodRes.warehouses);
      if (prodRes.warehouses[0] && !selectedWhId) setSelectedWhId(String(prodRes.warehouses[0].id));
      if (prodRes.products[0] && !rfqProductId) {
        setRfqProductId(String(prodRes.products[0].id));
        setRfqPrice(String(prodRes.products[0].cost_price));
      }
      const customers = tpRes.thirdParties.filter((tp) => tp.party_type !== 'supplier');
      const suppliers = tpRes.thirdParties.filter(
        (tp) => tp.party_type === 'supplier' || tp.party_type === 'customer_supplier'
      );
      if (customers[0]) {
        if (!oppPartyId) setOppPartyId(String(customers[0].id));
        if (!ctrPartyId) setCtrPartyId(String(customers[0].id));
        if (!intPartyId) setIntPartyId(String(customers[0].id));
      }
      if (suppliers[0] && !rfqPartyId) {
        setRfqPartyId(String(suppliers[0].id));
      }

      if (canSalesRead) {
        const [propRes, soRes, extRes] = await Promise.all([
          apiRequest<{ proposals: Proposal[] }>('/api/proposals'),
          apiRequest<{ salesOrders: SalesOrder[] }>('/api/sales-orders'),
          apiRequest<{
            opportunities: OpportunityItem[];
            contracts: ContractItem[];
            shipments: ShipmentItem[];
            interventions: InterventionItem[];
            rfqs: SupplierRfq[];
          }>('/api/commerce-extensions'),
        ]);
        setProposals(propRes.proposals);
        setSalesOrders(soRes.salesOrders);
        setOpportunities(extRes.opportunities);
        setContracts(extRes.contracts);
        setShipments(extRes.shipments);
        setInterventions(extRes.interventions);
        setRfqs(extRes.rfqs);
        if (soRes.salesOrders[0] && !shipOrderId) setShipOrderId(String(soRes.salesOrders[0].id));
      }
      if (canPurchRead) {
        const poRes = await apiRequest<{ purchaseOrders: PurchaseOrder[] }>('/api/purchase-orders');
        setPurchaseOrders(poRes.purchaseOrders);
        if (!canSalesRead) {
          const extRes = await apiRequest<{ rfqs: SupplierRfq[] }>('/api/commerce-extensions').catch(() => ({
            rfqs: [],
          }));
          setRfqs(extRes.rfqs ?? []);
        }
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load commercial documents.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canSalesRead && canPurchRead) {
      setTab('purchase_orders');
    }
    loadAll();
  }, []);

  useEffect(() => {
    if (!focusHint?.subTab) return;
    if (
      focusHint.subTab === 'proposals' ||
      focusHint.subTab === 'sales_orders' ||
      focusHint.subTab === 'purchase_orders'
    ) {
      setTab(focusHint.subTab);
    }
  }, [focusHint?.ts]);

  function openNewModal(kind: 'proposal' | 'sales_order' | 'purchase_order') {
    setEditingDoc(null);
    setDocKind(kind);
    const matchingParties = thirdParties.filter((tp) =>
      kind === 'purchase_order'
        ? tp.party_type === 'supplier' || tp.party_type === 'customer_supplier'
        : tp.party_type !== 'supplier'
    );
    setSelectedPartyId(matchingParties[0] ? String(matchingParties[0].id) : '');
    if (warehouses[0]) setSelectedWhId(String(warehouses[0].id));
    setDocIncoterm(kind === 'purchase_order' ? 'FOB' : 'EXW');
    setDocTitle('');
    setDocDate('');
    setDocNotes('');
    if (products[0]) {
      setLines([
        {
          productId: products[0].id,
          ref: products[0].ref,
          label: products[0].name,
          qty: 1,
          unitPrice: kind === 'purchase_order' ? products[0].cost_price : products[0].sell_price,
          discountPct: 0,
          taxRate: products[0].tax_rate,
        },
      ]);
    } else {
      setLines([{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }]);
    }
    setCreateOpen(true);
  }

  function parseDocLines(raw: string): DocumentLine[] {
    try {
      const arr = JSON.parse(raw || '[]') as DocumentLine[];
      return arr.length > 0
        ? arr
        : [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }];
    } catch {
      return [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }];
    }
  }

  function openEditProposal(pr: Proposal) {
    setDocKind('proposal');
    setEditingDoc({ kind: 'proposal', record: pr });
    setSelectedPartyId(String(pr.third_party_id));
    setDocTitle(pr.title);
    setDocDate(pr.valid_until);
    setDocNotes(pr.notes);
    setLines(parseDocLines(pr.lines_json));
    setCreateOpen(true);
  }

  function openEditSalesOrder(so: SalesOrder) {
    setDocKind('sales_order');
    setEditingDoc({ kind: 'sales_order', record: so });
    setSelectedPartyId(String(so.third_party_id));
    setSelectedWhId(String(so.warehouse_id));
    setDocIncoterm(so.incoterm || 'EXW');
    setDocDate(so.delivery_date);
    setDocNotes(so.notes);
    setLines(parseDocLines(so.lines_json));
    setCreateOpen(true);
  }

  function openEditPurchaseOrder(po: PurchaseOrder) {
    setDocKind('purchase_order');
    setEditingDoc({ kind: 'purchase_order', record: po });
    setSelectedPartyId(String(po.third_party_id));
    setSelectedWhId(String(po.warehouse_id));
    setDocIncoterm(po.incoterm || 'FOB');
    setDocDate(po.expected_date);
    setDocNotes(po.notes);
    setLines(parseDocLines(po.lines_json));
    setCreateOpen(true);
  }

  function handleSelectProduct(index: number, productIdStr: string) {
    const prod = products.find((p) => p.id === Number(productIdStr));
    setLines((prev) =>
      prev.map((l, idx) =>
        idx === index && prod
          ? {
              ...l,
              productId: prod.id,
              ref: prod.ref,
              label: prod.name,
              unitPrice: docKind === 'purchase_order' ? prod.cost_price : prod.sell_price,
              taxRate: prod.tax_rate,
            }
          : l
      )
    );
  }

  async function handleSaveDoc(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingDoc) {
        if (editingDoc.kind === 'proposal') {
          await apiRequest(`/api/proposals/${editingDoc.record.id}`, {
            method: 'PUT',
            body: {
              thirdPartyId: Number(selectedPartyId),
              title: docTitle,
              validUntil: docDate || undefined,
              lines,
              notes: docNotes,
            },
          });
          onNotify(`Updated ${editingDoc.record.ref}.`);
        } else if (editingDoc.kind === 'sales_order') {
          const locked = editingDoc.record.status === 'shipped' || editingDoc.record.status === 'billed';
          await apiRequest(`/api/sales-orders/${editingDoc.record.id}`, {
            method: 'PUT',
            body: locked
              ? { deliveryDate: docDate || undefined, incoterm: docIncoterm, notes: docNotes }
              : {
                  thirdPartyId: Number(selectedPartyId),
                  warehouseId: Number(selectedWhId),
                  deliveryDate: docDate || undefined,
                  incoterm: docIncoterm,
                  lines,
                  notes: docNotes,
                },
          });
          onNotify(`Updated ${editingDoc.record.ref}.`);
        } else {
          const locked = editingDoc.record.status === 'received' || editingDoc.record.status === 'billed';
          await apiRequest(`/api/purchase-orders/${editingDoc.record.id}`, {
            method: 'PUT',
            body: locked
              ? { expectedDate: docDate || undefined, incoterm: docIncoterm, notes: docNotes }
              : {
                  thirdPartyId: Number(selectedPartyId),
                  warehouseId: Number(selectedWhId),
                  expectedDate: docDate || undefined,
                  incoterm: docIncoterm,
                  lines,
                  notes: docNotes,
                },
          });
          onNotify(`Updated ${editingDoc.record.ref}.`);
        }
      } else if (docKind === 'proposal') {
        await apiRequest('/api/proposals', {
          method: 'POST',
          body: { thirdPartyId: Number(selectedPartyId), title: docTitle, lines, notes: docNotes },
        });
        onNotify('Commercial proposal created.');
      } else if (docKind === 'sales_order') {
        await apiRequest('/api/sales-orders', {
          method: 'POST',
          body: {
            thirdPartyId: Number(selectedPartyId),
            warehouseId: Number(selectedWhId),
            incoterm: docIncoterm,
            lines,
            notes: docNotes,
          },
        });
        onNotify('Sales order created.');
      } else {
        await apiRequest('/api/purchase-orders', {
          method: 'POST',
          body: {
            thirdPartyId: Number(selectedPartyId),
            warehouseId: Number(selectedWhId),
            incoterm: docIncoterm,
            lines,
            notes: docNotes,
          },
        });
        onNotify('Purchase order created.');
      }
      setCreateOpen(false);
      setEditingDoc(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save document.', 'error');
    }
  }

  async function handleSignProposal(e: FormEvent) {
    e.preventDefault();
    if (!signModal) return;
    try {
      await apiRequest(`/api/proposals/${signModal.id}/sign`, {
        method: 'POST',
        body: { signatureName: signerName, signerEmail },
      });
      setSignModal(null);
      setSignerName('');
      setSignerEmail('');
      onNotify('Proposal signed electronically.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Signing failed.', 'error');
    }
  }

  function openCreateOpp() {
    setEditingOpp(null);
    const customers = thirdParties.filter((tp) => tp.party_type !== 'supplier');
    if (customers[0]) setOppPartyId(String(customers[0].id));
    setOppTitle('');
    setOppStage('qualification');
    setOppProb('35');
    setOppAmount('12000');
    setOppCloseDate('');
    setOppModal(true);
  }

  function openEditOpp(opp: OpportunityItem) {
    setEditingOpp(opp);
    setOppPartyId(String(opp.third_party_id));
    setOppTitle(opp.title);
    setOppStage(opp.stage);
    setOppProb(String(opp.probability));
    setOppAmount(String(opp.amount));
    setOppCloseDate(opp.close_date);
    setOppModal(true);
  }

  async function handleSaveOpportunity(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(oppPartyId),
        title: oppTitle,
        stage: oppStage,
        probability: Number(oppProb),
        amount: Number(oppAmount),
        closeDate: oppCloseDate || undefined,
      };
      if (editingOpp) {
        await apiRequest(`/api/opportunities/${editingOpp.id}`, { method: 'PUT', body });
        onNotify(`Updated ${editingOpp.ref}.`);
      } else {
        await apiRequest('/api/opportunities', { method: 'POST', body });
        onNotify('Opportunity added to sales pipeline.');
      }
      setOppModal(false);
      setEditingOpp(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save opportunity.', 'error');
    }
  }

  async function handleConvertOpp(id: number) {
    try {
      await apiRequest(`/api/opportunities/${id}/convert-proposal`, { method: 'POST', body: {} });
      onNotify('Opportunity converted to Commercial Proposal.');
      setTab('proposals');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Conversion failed.', 'error');
    }
  }

  async function handleUpdateOppStage(id: number, stage: string) {
    try {
      await apiRequest(`/api/opportunities/${id}`, { method: 'PUT', body: { stage } });
      onNotify(`Opportunity stage updated to ${stage}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Stage update failed.', 'error');
    }
  }

  function openCreateCtr() {
    setEditingCtr(null);
    const customers = thirdParties.filter((tp) => tp.party_type !== 'supplier');
    if (customers[0]) setCtrPartyId(String(customers[0].id));
    setCtrTitle('');
    setCtrCycle('monthly');
    setCtrAmount('1450');
    setCtrStatus('active');
    setCtrModal(true);
  }

  function openEditCtr(c: ContractItem) {
    setEditingCtr(c);
    setCtrPartyId(String(c.third_party_id));
    setCtrTitle(c.title);
    setCtrCycle(c.billing_cycle);
    setCtrAmount(String(c.recurring_amount));
    setCtrStatus(c.status);
    setCtrModal(true);
  }

  async function handleSaveContract(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(ctrPartyId),
        title: ctrTitle,
        billingCycle: ctrCycle,
        recurringAmount: Number(ctrAmount),
        status: editingCtr ? ctrStatus : undefined,
      };
      if (editingCtr) {
        await apiRequest(`/api/contracts/${editingCtr.id}`, { method: 'PUT', body });
        onNotify(`Updated contract ${editingCtr.ref}.`);
      } else {
        await apiRequest('/api/contracts', { method: 'POST', body });
        onNotify('Subscription contract activated.');
      }
      setCtrModal(false);
      setEditingCtr(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save contract.', 'error');
    }
  }

  async function handleInvoiceContract(id: number) {
    try {
      await apiRequest(`/api/contracts/${id}/generate-invoice`, { method: 'POST', body: {} });
      onNotify('Recurring cycle invoice generated in Billing.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to invoice contract.', 'error');
    }
  }

  function openCreateShip() {
    setEditingShip(null);
    if (salesOrders[0]) setShipOrderId(String(salesOrders[0].id));
    setShipCarrier('DHL Freight');
    setShipTracking('');
    setShipWeight('12');
    setShipDate(new Date().toISOString().slice(0, 10));
    setShipStatus('in_transit');
    setShipModal(true);
  }

  function openEditShip(sh: ShipmentItem) {
    setEditingShip(sh);
    setShipOrderId(String(sh.sales_order_id));
    setShipCarrier(sh.carrier);
    setShipTracking(sh.tracking_number);
    setShipWeight(String(sh.weight_kg));
    setShipDate(sh.ship_date);
    setShipStatus(sh.status);
    setShipModal(true);
  }

  async function handleSaveShipment(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingShip) {
        await apiRequest(`/api/shipments/${editingShip.id}`, {
          method: 'PUT',
          body: {
            carrier: shipCarrier,
            trackingNumber: shipTracking,
            shipDate: shipDate || undefined,
            weightKg: Number(shipWeight),
            status: shipStatus,
          },
        });
        onNotify(`Updated shipment ${editingShip.ref}.`);
      } else {
        await apiRequest('/api/shipments', {
          method: 'POST',
          body: {
            salesOrderId: Number(shipOrderId),
            carrier: shipCarrier,
            trackingNumber: shipTracking,
            shipDate: shipDate || undefined,
            weightKg: Number(shipWeight),
          },
        });
        onNotify('Dispatch shipment created.');
      }
      setShipModal(false);
      setEditingShip(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save shipment.', 'error');
    }
  }

  async function handleShipmentStatus(id: number, status: string) {
    try {
      await apiRequest(`/api/shipments/${id}`, { method: 'PUT', body: { status } });
      onNotify(`Shipment updated to ${status}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Shipment update failed.', 'error');
    }
  }

  function openCreateInt() {
    setEditingInt(null);
    const customers = thirdParties.filter((tp) => tp.party_type !== 'supplier');
    if (customers[0]) setIntPartyId(String(customers[0].id));
    setIntTitle('');
    setIntTech('');
    setIntHours('3');
    setIntDate(new Date().toISOString().slice(0, 10));
    setIntStatus('planned');
    setIntModal(true);
  }

  function openEditInt(iv: InterventionItem) {
    setEditingInt(iv);
    setIntPartyId(String(iv.third_party_id));
    setIntTitle(iv.title);
    setIntTech(iv.technician_name);
    setIntHours(String(iv.duration_hours));
    setIntDate(iv.scheduled_date);
    setIntStatus(iv.status);
    setIntModal(true);
  }

  async function handleSaveIntervention(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(intPartyId),
        title: intTitle,
        technicianName: intTech,
        scheduledDate: intDate || undefined,
        durationHours: Number(intHours),
        status: editingInt ? intStatus : undefined,
      };
      if (editingInt) {
        await apiRequest(`/api/interventions/${editingInt.id}`, { method: 'PUT', body });
        onNotify(`Updated intervention ${editingInt.ref}.`);
      } else {
        await apiRequest('/api/interventions', { method: 'POST', body });
        onNotify('Field intervention scheduled.');
      }
      setIntModal(false);
      setEditingInt(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save intervention.', 'error');
    }
  }

  async function handleInterventionStatus(id: number, status: string) {
    try {
      await apiRequest(`/api/interventions/${id}`, { method: 'PUT', body: { status } });
      onNotify(`Intervention marked ${status}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Intervention update failed.', 'error');
    }
  }

  function openCreateRfq() {
    setEditingRfq(null);
    const suppliers = thirdParties.filter(
      (tp) => tp.party_type === 'supplier' || tp.party_type === 'customer_supplier'
    );
    if (suppliers[0]) setRfqPartyId(String(suppliers[0].id));
    setRfqTitle('');
    setRfqIncoterm('CIF');
    if (products[0]) {
      setRfqProductId(String(products[0].id));
      setRfqPrice(String(products[0].cost_price));
    }
    setRfqQty('25');
    setRfqDeadline('');
    setRfqStatus('open');
    setRfqModal(true);
  }

  function openEditRfq(r: SupplierRfq) {
    setEditingRfq(r);
    setRfqPartyId(String(r.third_party_id));
    setRfqTitle(r.title);
    setRfqIncoterm(r.incoterm);
    setRfqDeadline(r.deadline_date);
    setRfqStatus(r.status);
    try {
      const raw = (r as SupplierRfq & { lines_json?: string }).lines_json;
      const parsed = JSON.parse(raw || '[]') as Array<{ productId?: number | null; qty?: number; unitPrice?: number }>;
      if (parsed[0]) {
        setRfqProductId(parsed[0].productId ? String(parsed[0].productId) : '');
        setRfqQty(String(parsed[0].qty ?? 1));
        setRfqPrice(String(parsed[0].unitPrice ?? 0));
      }
    } catch {
      // ignore parse fallback
    }
    setRfqModal(true);
  }

  async function handleSaveRfq(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(rfqPartyId),
        title: rfqTitle,
        incoterm: rfqIncoterm,
        deadlineDate: rfqDeadline || undefined,
        productId: rfqProductId ? Number(rfqProductId) : null,
        qty: Number(rfqQty),
        unitPrice: Number(rfqPrice),
        status: editingRfq ? rfqStatus : undefined,
      };
      if (editingRfq) {
        await apiRequest(`/api/supplier-rfqs/${editingRfq.id}`, { method: 'PUT', body });
        onNotify(`Updated RFQ ${editingRfq.ref}.`);
      } else {
        await apiRequest('/api/supplier-rfqs', { method: 'POST', body });
        onNotify('Supplier pricing request created.');
      }
      setRfqModal(false);
      setEditingRfq(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save RFQ.', 'error');
    }
  }

  async function handleConvertRfq(id: number) {
    try {
      await apiRequest(`/api/supplier-rfqs/${id}/convert-po`, { method: 'POST', body: {} });
      onNotify('RFQ converted to Purchase Order.');
      setTab('purchase_orders');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'RFQ conversion failed.', 'error');
    }
  }

  async function updateProposalStatus(id: number, status: string) {
    try {
      await apiRequest(`/api/proposals/${id}/status`, { method: 'POST', body: { status } });
      onNotify(`Proposal marked as ${status}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status update failed.', 'error');
    }
  }

  async function convertProposalToOrder(id: number) {
    try {
      await apiRequest(`/api/proposals/${id}/convert-order`, { method: 'POST', body: {} });
      onNotify('Proposal converted to Sales Order.');
      setTab('sales_orders');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Conversion failed.', 'error');
    }
  }

  async function updateSalesOrderStatus(id: number, status: string) {
    try {
      await apiRequest(`/api/sales-orders/${id}/status`, { method: 'POST', body: { status } });
      onNotify(`Sales order marked as ${status}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Order update failed.', 'error');
    }
  }

  async function convertSalesOrderToInvoice(id: number) {
    try {
      await apiRequest(`/api/sales-orders/${id}/convert-invoice`, { method: 'POST', body: {} });
      onNotify('Customer invoice generated from Sales Order.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Invoice generation failed.', 'error');
    }
  }

  async function updatePurchaseOrderStatus(id: number, status: string) {
    try {
      await apiRequest(`/api/purchase-orders/${id}/status`, { method: 'POST', body: { status } });
      onNotify(`Purchase order marked as ${status}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Purchase order update failed.', 'error');
    }
  }

  async function convertPoToBill(id: number) {
    try {
      await apiRequest(`/api/purchase-orders/${id}/convert-bill`, { method: 'POST', body: {} });
      onNotify('Supplier bill created in Billing & Treasury.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Bill conversion failed.', 'error');
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
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const linePreviewTotals = lines.reduce(
    (acc, l) => {
      const net = l.qty * l.unitPrice * (1 - (l.discountPct || 0) / 100);
      const tax = net * ((l.taxRate || 0) / 100);
      return { ht: acc.ht + net, tax: acc.tax + tax, ttc: acc.ttc + net + tax };
    },
    { ht: 0, tax: 0, ttc: 0 }
  );

  const partyOptions = thirdParties.filter((tp) =>
    docKind === 'purchase_order'
      ? tp.party_type === 'supplier' || tp.party_type === 'customer_supplier'
      : tp.party_type !== 'supplier'
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          {canSalesRead && (
            <>
              <button
                type="button"
                onClick={() => setTab('opportunities')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'opportunities'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>Leads/Opps ({opportunities.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('proposals')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'proposals'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Proposals ({proposals.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('sales_orders')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'sales_orders'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Sales Orders ({salesOrders.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('contracts')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'contracts'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Contracts ({contracts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('shipments')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'shipments'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Shipping ({shipments.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('interventions')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'interventions'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Interventions ({interventions.length})</span>
              </button>
            </>
          )}
          {canPurchRead && (
            <>
              <button
                type="button"
                onClick={() => setTab('rfqs')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'rfqs'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>Supplier RFQs ({rfqs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('purchase_orders')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'purchase_orders'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Purchase Orders ({purchaseOrders.length})</span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {tab === 'opportunities' && canSalesWrite && (
            <button
              type="button"
              onClick={openCreateOpp}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Opportunity</span>
            </button>
          )}
          {tab === 'proposals' && canSalesWrite && (
            <button
              type="button"
              onClick={() => openNewModal('proposal')}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Proposal</span>
            </button>
          )}
          {tab === 'sales_orders' && canSalesWrite && (
            <button
              type="button"
              onClick={() => openNewModal('sales_order')}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Sales Order</span>
            </button>
          )}
          {tab === 'contracts' && canSalesWrite && (
            <button
              type="button"
              onClick={openCreateCtr}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Contract</span>
            </button>
          )}
          {tab === 'shipments' && canSalesValidate && (
            <button
              type="button"
              onClick={openCreateShip}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Dispatch Shipment</span>
            </button>
          )}
          {tab === 'interventions' && canSalesWrite && (
            <button
              type="button"
              onClick={openCreateInt}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule Intervention</span>
            </button>
          )}
          {tab === 'rfqs' && canPurchWrite && (
            <button
              type="button"
              onClick={openCreateRfq}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Pricing Request</span>
            </button>
          )}
          {tab === 'purchase_orders' && canPurchWrite && (
            <button
              type="button"
              onClick={() => openNewModal('purchase_order')}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Purchase Order</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading commercial records...</div>
        ) : tab === 'opportunities' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Lead · Opportunity</th>
                  <th className="py-3 px-4 font-medium">Close Date</th>
                  <th className="py-3 px-4 font-medium text-right">Amount</th>
                  <th className="py-3 px-4 font-medium text-right">Prob.</th>
                  <th className="py-3 px-4 font-medium">Stage</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {opportunities.map((opp) => (
                  <tr key={opp.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {opp.ref}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100 text-xs">{opp.title}</div>
                      <div className="text-[11px] text-zinc-500">{opp.party_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(opp.close_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium">
                      {formatCurrency(opp.amount)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-zinc-500">
                      {opp.probability}%
                    </td>
                    <td className="py-3 px-4">
                      {canSalesWrite ? (
                        <select
                          value={opp.stage}
                          onChange={(e) => handleUpdateOppStage(opp.id, e.target.value)}
                          className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        >
                          <option value="qualification">Qualification</option>
                          <option value="proposition">Proposition</option>
                          <option value="negotiation">Negotiation</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                        </select>
                      ) : (
                        <StatusText status={opp.stage} />
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {canSalesValidate && opp.stage !== 'lost' && (
                          <button
                            type="button"
                            onClick={() => handleConvertOpp(opp.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline mr-1"
                          >
                            <span>Convert to Proposal</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {canSalesWrite && (
                          <button
                            type="button"
                            onClick={() => openEditOpp(opp)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit opportunity"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/opportunities/${opp.id}`, `${opp.ref} (${opp.title})`)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete opportunity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'proposals' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Customer · Title</th>
                  <th className="py-3 px-4 font-medium">Valid Until</th>
                  <th className="py-3 px-4 font-medium text-right">Amount (TTC)</th>
                  <th className="py-3 px-4 font-medium">Status / Signature</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {proposals.map((pr) => (
                  <tr key={pr.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {pr.ref}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{pr.title}</div>
                      <div className="text-xs text-zinc-500">{pr.customer_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">
                      {formatDate(pr.valid_until)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(pr.total_ttc)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={pr.status} />
                      {pr.signature_name && (
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          Signed by {pr.signature_name}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2.5">
                        {canSalesValidate && pr.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => updateProposalStatus(pr.id, 'validated')}
                            className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Validate
                          </button>
                        )}
                        {canSalesValidate && (pr.status === 'validated' || pr.status === 'draft') && (
                          <button
                            type="button"
                            onClick={() => {
                              setSignModal(pr);
                              setSignerName('');
                              setSignerEmail('');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                          >
                            <FileSignature className="w-3.5 h-3.5" />
                            <span>Online Sign</span>
                          </button>
                        )}
                        {canSalesValidate && (pr.status === 'validated' || pr.status === 'signed') && (
                          <button
                            type="button"
                            onClick={() => convertProposalToOrder(pr.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            <span>Convert to Order</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {canSalesWrite && (
                          <button
                            type="button"
                            onClick={() => openEditProposal(pr)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit proposal"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/proposals/${pr.id}`, `${pr.ref} (${pr.title})`)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete proposal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'sales_orders' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Customer</th>
                  <th className="py-3 px-4 font-medium">Warehouse · Incoterm</th>
                  <th className="py-3 px-4 font-medium">Delivery Date</th>
                  <th className="py-3 px-4 font-medium text-right">Total (TTC)</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Workflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {salesOrders.map((so) => (
                  <tr key={so.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {so.ref}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {so.customer_name}
                      {so.proposal_ref && (
                        <span className="block text-[11px] font-mono text-zinc-400">From {so.proposal_ref}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {so.warehouse_name}
                      <span className="ml-2 font-mono text-[11px] text-zinc-500">{so.incoterm || 'EXW'}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(so.delivery_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(so.total_ttc)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={so.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2.5">
                        {canSalesValidate && so.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => updateSalesOrderStatus(so.id, 'validated')}
                            className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Validate
                          </button>
                        )}
                        {canSalesValidate && so.status === 'validated' && (
                          <button
                            type="button"
                            onClick={() => updateSalesOrderStatus(so.id, 'shipped')}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Ship & Deduct Stock</span>
                          </button>
                        )}
                        {canBillingWrite && (so.status === 'validated' || so.status === 'shipped') && (
                          <button
                            type="button"
                            onClick={() => convertSalesOrderToInvoice(so.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Create Invoice</span>
                          </button>
                        )}
                        {canSalesWrite && (
                          <button
                            type="button"
                            onClick={() => openEditSalesOrder(so)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit sales order"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && so.status !== 'shipped' && so.status !== 'billed' && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(
                                `/api/sales-orders/${so.id}`,
                                so.ref,
                                'Only draft or validated sales orders without shipments can be deleted.'
                              )
                            }
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete sales order"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'contracts' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Customer · Service</th>
                  <th className="py-3 px-4 font-medium">Cycle</th>
                  <th className="py-3 px-4 font-medium">Next Billing</th>
                  <th className="py-3 px-4 font-medium text-right">Recurring Fee</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {contracts.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {c.ref}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-xs text-zinc-900 dark:text-zinc-100">{c.title}</div>
                      <div className="text-[11px] text-zinc-500">{c.customer_name}</div>
                    </td>
                    <td className="py-3 px-4 text-xs capitalize text-zinc-600 dark:text-zinc-400">
                      {c.billing_cycle}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(c.next_billing_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium">
                      {formatCurrency(c.recurring_amount)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {canBillingWrite && c.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => handleInvoiceContract(c.id)}
                            className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline mr-1"
                          >
                            Generate Cycle Invoice
                          </button>
                        )}
                        {canSalesWrite && (
                          <button
                            type="button"
                            onClick={() => openEditCtr(c)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit contract"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/contracts/${c.id}`, `${c.ref} (${c.title})`)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete contract"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'shipments' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Shipment Ref</th>
                  <th className="py-3 px-4 font-medium">Order · Customer</th>
                  <th className="py-3 px-4 font-medium">Carrier · Tracking</th>
                  <th className="py-3 px-4 font-medium">Ship Date</th>
                  <th className="py-3 px-4 font-medium text-right">Weight</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {shipments.map((sh) => (
                  <tr key={sh.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {sh.ref}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{sh.customer_name}</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {sh.order_ref} · {sh.warehouse_name}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div>{sh.carrier}</div>
                      <div className="font-mono text-[11px] text-zinc-500">{sh.tracking_number}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(sh.ship_date)}</td>
                    <td className="py-3 px-4 font-mono text-xs text-right">{sh.weight_kg} kg</td>
                    <td className="py-3 px-4">
                      {canSalesValidate ? (
                        <select
                          value={sh.status}
                          onChange={(e) => handleShipmentStatus(sh.id, e.target.value)}
                          className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        >
                          <option value="packed">Packed</option>
                          <option value="in_transit">In Transit</option>
                          <option value="delivered">Delivered</option>
                        </select>
                      ) : (
                        <StatusText status={sh.status} />
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {(canSalesWrite || canSalesValidate) && (
                          <button
                            type="button"
                            onClick={() => openEditShip(sh)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit shipment"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/shipments/${sh.id}`, sh.ref)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete shipment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'interventions' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Customer · Scope</th>
                  <th className="py-3 px-4 font-medium">Technician</th>
                  <th className="py-3 px-4 font-medium">Scheduled</th>
                  <th className="py-3 px-4 font-medium text-right">Duration</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {interventions.map((iv) => (
                  <tr key={iv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {iv.ref}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{iv.title}</div>
                      <div className="text-[11px] text-zinc-500">{iv.customer_name}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">{iv.technician_name}</td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(iv.scheduled_date)}</td>
                    <td className="py-3 px-4 font-mono text-xs text-right">{iv.duration_hours}h</td>
                    <td className="py-3 px-4">
                      {canSalesValidate ? (
                        <select
                          value={iv.status}
                          onChange={(e) => handleInterventionStatus(iv.id, e.target.value)}
                          className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        >
                          <option value="planned">Planned</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="billed">Billed</option>
                        </select>
                      ) : (
                        <StatusText status={iv.status} />
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {(canSalesWrite || canSalesValidate) && (
                          <button
                            type="button"
                            onClick={() => openEditInt(iv)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit intervention"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSalesDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/interventions/${iv.id}`, `${iv.ref} (${iv.title})`)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete intervention"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'rfqs' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">RFQ Ref</th>
                  <th className="py-3 px-4 font-medium">Supplier · Title</th>
                  <th className="py-3 px-4 font-medium">Incoterm</th>
                  <th className="py-3 px-4 font-medium">Deadline</th>
                  <th className="py-3 px-4 font-medium text-right">Est. Total</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rfqs.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {r.ref}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                      <div className="text-[11px] text-zinc-500">{r.supplier_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{r.incoterm}</td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(r.deadline_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium">
                      {formatCurrency(r.estimated_total)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={r.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {canPurchValidate && r.status !== 'accepted' && (
                          <button
                            type="button"
                            onClick={() => handleConvertRfq(r.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline mr-1"
                          >
                            <span>Convert to PO</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {canPurchWrite && (
                          <button
                            type="button"
                            onClick={() => openEditRfq(r)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit RFQ"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canPurchDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/supplier-rfqs/${r.id}`, `${r.ref} (${r.title})`)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete RFQ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Supplier</th>
                  <th className="py-3 px-4 font-medium">Receiving Warehouse · Incoterm</th>
                  <th className="py-3 px-4 font-medium">Expected Date</th>
                  <th className="py-3 px-4 font-medium text-right">Total (TTC)</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Workflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {po.ref}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {po.supplier_name}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {po.warehouse_name}
                      <span className="ml-2 font-mono text-[11px] text-zinc-500">{po.incoterm || 'FOB'}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(po.expected_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(po.total_ttc)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={po.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2.5">
                        {canPurchValidate && po.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => updatePurchaseOrderStatus(po.id, 'ordered')}
                            className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Place Order
                          </button>
                        )}
                        {canPurchValidate && po.status === 'ordered' && (
                          <button
                            type="button"
                            onClick={() => updatePurchaseOrderStatus(po.id, 'received')}
                            className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            Receive Stock
                          </button>
                        )}
                        {canBillingWrite && (po.status === 'ordered' || po.status === 'received') && (
                          <button
                            type="button"
                            onClick={() => convertPoToBill(po.id)}
                            className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                          >
                            Create Supplier Bill
                          </button>
                        )}
                        {canPurchWrite && (
                          <button
                            type="button"
                            onClick={() => openEditPurchaseOrder(po)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit purchase order"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canPurchDelete && po.status !== 'received' && po.status !== 'billed' && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(
                                `/api/purchase-orders/${po.id}`,
                                po.ref,
                                'Only draft or ordered purchase orders can be deleted.'
                              )
                            }
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete purchase order"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Commercial Document Modal */}
      {(() => {
        const docLinesLocked = Boolean(
          editingDoc &&
            ((editingDoc.kind === 'sales_order' &&
              (editingDoc.record.status === 'shipped' || editingDoc.record.status === 'billed')) ||
              (editingDoc.kind === 'purchase_order' &&
                (editingDoc.record.status === 'received' || editingDoc.record.status === 'billed')))
        );
        return (
          <Modal
            open={createOpen}
            onClose={() => {
              setCreateOpen(false);
              setEditingDoc(null);
            }}
            title={
              editingDoc
                ? `Edit ${
                    docKind === 'proposal'
                      ? 'Proposal'
                      : docKind === 'sales_order'
                      ? 'Sales Order'
                      : 'Purchase Order'
                  } — ${editingDoc.record.ref}`
                : docKind === 'proposal'
                ? 'New Commercial Proposal'
                : docKind === 'sales_order'
                ? 'New Sales Order'
                : 'New Purchase Order'
            }
            subtitle={
              docLinesLocked
                ? 'Order already fulfilled/billed: party, warehouse, and lines are locked; dates, incoterm, and notes remain editable.'
                : 'Add catalog items or custom lines with automated VAT, discount, and Incoterm assignment.'
            }
            maxWidthClass="max-w-3xl"
          >
            <form onSubmit={handleSaveDoc} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {docKind === 'purchase_order' ? 'Supplier' : 'Customer / Prospect'}
                  </label>
                  <select
                    required
                    disabled={docLinesLocked}
                    value={selectedPartyId}
                    onChange={(e) => setSelectedPartyId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                  >
                    {partyOptions.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.ref} — {tp.name}
                      </option>
                    ))}
                  </select>
                </div>

                {docKind === 'proposal' ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Proposal Subject / Title
                      </label>
                      <input
                        type="text"
                        required
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="e.g. Q1 Sensor Deployment"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Valid Until
                      </label>
                      <input
                        type="date"
                        value={docDate}
                        onChange={(e) => setDocDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        {docKind === 'sales_order' ? 'Dispatch Warehouse' : 'Receiving Warehouse'}
                      </label>
                      <select
                        required
                        disabled={docLinesLocked}
                        value={selectedWhId}
                        onChange={(e) => setSelectedWhId(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                      >
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.ref} — {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Incoterm
                        </label>
                        <select
                          value={docIncoterm}
                          onChange={(e) => setDocIncoterm(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        >
                          {INCOTERMS.map((term) => (
                            <option key={term} value={term}>
                              {term}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          {docKind === 'sales_order' ? 'Delivery' : 'Expected'}
                        </label>
                        <input
                          type="date"
                          value={docDate}
                          onChange={(e) => setDocDate(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Document Line Items
                  </span>
                  {!docLinesLocked && (
                    <button
                      type="button"
                      onClick={() =>
                        setLines((prev) => [
                          ...prev,
                          { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 },
                        ])
                      }
                      className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Line</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40"
                    >
                      <div className="col-span-12 sm:col-span-4">
                        <select
                          disabled={docLinesLocked}
                          value={line.productId ?? ''}
                          onChange={(e) => handleSelectProduct(idx, e.target.value)}
                          className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-60"
                        >
                          <option value="">Custom item...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.ref} — {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-12 sm:col-span-3">
                        <input
                          type="text"
                          required
                          disabled={docLinesLocked}
                          value={line.label}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item))
                            )
                          }
                          placeholder="Description"
                          className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-60"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-1">
                        <input
                          type="number"
                          min={1}
                          required
                          disabled={docLinesLocked}
                          value={line.qty}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, qty: Number(e.target.value) } : item))
                            )
                          }
                          title="Quantity"
                          className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-60"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          required
                          disabled={docLinesLocked}
                          value={line.unitPrice}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, unitPrice: Number(e.target.value) } : item
                              )
                            )
                          }
                          title="Unit Price"
                          className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-60"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={docLinesLocked}
                          value={line.discountPct}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, discountPct: Number(e.target.value) } : item
                              )
                            )
                          }
                          title="Discount %"
                          className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-60"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {!docLinesLocked && lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-zinc-400 hover:text-red-600"
                            aria-label="Remove line"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex-1">
                  <input
                    type="text"
                    value={docNotes}
                    onChange={(e) => setDocNotes(e.target.value)}
                    placeholder="Internal or customer notes..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>
                <div className="text-right space-y-0.5 text-xs font-mono">
                  <div className="text-zinc-500">Subtotal (HT): {formatCurrency(linePreviewTotals.ht)}</div>
                  <div className="text-zinc-500">VAT: {formatCurrency(linePreviewTotals.tax)}</div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Total (TTC): {formatCurrency(linePreviewTotals.ttc)}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    setEditingDoc(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
                >
                  {editingDoc ? 'Save Changes' : 'Save Draft Document'}
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* Online Signing Modal */}
      <Modal
        open={Boolean(signModal)}
        onClose={() => setSignModal(null)}
        title={signModal ? `Electronic Proposal Acceptance — ${signModal.ref}` : ''}
        subtitle={signModal ? `${signModal.title} · Total ${formatCurrency(signModal.total_ttc)}` : ''}
      >
        <form onSubmit={handleSignProposal} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Authorized Signer Full Name
            </label>
            <input
              type="text"
              required
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Legal full name"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Signer Email (Audit Record)
            </label>
            <input
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="signer@customer.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSignModal(null)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium"
            >
              Confirm Online Signature
            </button>
          </div>
        </form>
      </Modal>

      {/* Opportunity Modal */}
      <Modal
        open={oppModal}
        onClose={() => {
          setOppModal(false);
          setEditingOpp(null);
        }}
        title={editingOpp ? `Edit Opportunity — ${editingOpp.ref}` : 'New Sales Opportunity'}
      >
        <form onSubmit={handleSaveOpportunity} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Customer / Prospect
            </label>
            <select
              required
              value={oppPartyId}
              onChange={(e) => setOppPartyId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              {thirdParties
                .filter((tp) => tp.party_type !== 'supplier')
                .map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.ref} — {tp.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Opportunity Title
            </label>
            <input
              type="text"
              required
              value={oppTitle}
              onChange={(e) => setOppTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Stage</label>
              <select
                value={oppStage}
                onChange={(e) => setOppStage(e.target.value as OpportunityItem['stage'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="qualification">Qualification</option>
                <option value="proposition">Proposition</option>
                <option value="negotiation">Negotiation</option>
                {editingOpp && <option value="won">Won</option>}
                {editingOpp && <option value="lost">Lost</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Prob. (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={oppProb}
                onChange={(e) => setOppProb(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={oppAmount}
                onChange={(e) => setOppAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Close Date</label>
              <input
                type="date"
                value={oppCloseDate}
                onChange={(e) => setOppCloseDate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOppModal(false);
                setEditingOpp(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingOpp ? 'Save Changes' : 'Create Opportunity'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Contract Modal */}
      <Modal
        open={ctrModal}
        onClose={() => {
          setCtrModal(false);
          setEditingCtr(null);
        }}
        title={editingCtr ? `Edit Contract — ${editingCtr.ref}` : 'New Recurring Contract / Subscription'}
      >
        <form onSubmit={handleSaveContract} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Customer</label>
            <select
              required
              value={ctrPartyId}
              onChange={(e) => setCtrPartyId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              {thirdParties
                .filter((tp) => tp.party_type !== 'supplier')
                .map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Contract Title</label>
            <input
              type="text"
              required
              value={ctrTitle}
              onChange={(e) => setCtrTitle(e.target.value)}
              placeholder="e.g. Managed Telemetry SLA"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className={`grid gap-3 ${editingCtr ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Billing Cycle
              </label>
              <select
                value={ctrCycle}
                onChange={(e) => setCtrCycle(e.target.value as typeof ctrCycle)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Recurring Fee (HT)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={ctrAmount}
                onChange={(e) => setCtrAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingCtr && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={ctrStatus}
                  onChange={(e) => setCtrStatus(e.target.value as ContractItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCtrModal(false);
                setEditingCtr(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingCtr ? 'Save Changes' : 'Activate Contract'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Shipment Modal */}
      <Modal
        open={shipModal}
        onClose={() => {
          setShipModal(false);
          setEditingShip(null);
        }}
        title={editingShip ? `Edit Shipment — ${editingShip.ref}` : 'Dispatch Sales Shipment'}
      >
        <form onSubmit={handleSaveShipment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Sales Order</label>
            <select
              required
              disabled={Boolean(editingShip)}
              value={shipOrderId}
              onChange={(e) => setShipOrderId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
            >
              {salesOrders.map((so) => (
                <option key={so.id} value={so.id}>
                  {so.ref} — {so.customer_name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Carrier</label>
              <input
                type="text"
                value={shipCarrier}
                onChange={(e) => setShipCarrier(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tracking #</label>
              <input
                type="text"
                value={shipTracking}
                onChange={(e) => setShipTracking(e.target.value)}
                placeholder="Auto if empty"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                value={shipWeight}
                onChange={(e) => setShipWeight(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingShip && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Ship Date</label>
                <input
                  type="date"
                  value={shipDate}
                  onChange={(e) => setShipDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={shipStatus}
                  onChange={(e) => setShipStatus(e.target.value as ShipmentItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="packed">Packed</option>
                  <option value="in_transit">In Transit</option>
                  <option value="delivered">Delivered</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShipModal(false);
                setEditingShip(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingShip ? 'Save Changes' : 'Create Shipment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Intervention Modal */}
      <Modal
        open={intModal}
        onClose={() => {
          setIntModal(false);
          setEditingInt(null);
        }}
        title={editingInt ? `Edit Intervention — ${editingInt.ref}` : 'Schedule Field Intervention'}
      >
        <form onSubmit={handleSaveIntervention} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Customer</label>
            <select
              required
              value={intPartyId}
              onChange={(e) => setIntPartyId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              {thirdParties
                .filter((tp) => tp.party_type !== 'supplier')
                .map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Intervention Title
            </label>
            <input
              type="text"
              required
              value={intTitle}
              onChange={(e) => setIntTitle(e.target.value)}
              placeholder="e.g. On-site PLC Sensor Calibration"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Technician</label>
              <input
                type="text"
                value={intTech}
                onChange={(e) => setIntTech(e.target.value)}
                placeholder="Assigned engineer"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Est. Duration (hrs)
              </label>
              <input
                type="number"
                step="0.5"
                min={0.5}
                value={intHours}
                onChange={(e) => setIntHours(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingInt && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Scheduled Date
                </label>
                <input
                  type="date"
                  value={intDate}
                  onChange={(e) => setIntDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={intStatus}
                  onChange={(e) => setIntStatus(e.target.value as InterventionItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="billed">Billed</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIntModal(false);
                setEditingInt(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingInt ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Supplier RFQ Modal */}
      <Modal
        open={rfqModal}
        onClose={() => {
          setRfqModal(false);
          setEditingRfq(null);
        }}
        title={editingRfq ? `Edit RFQ — ${editingRfq.ref}` : 'New Supplier Pricing Request (RFQ)'}
      >
        <form onSubmit={handleSaveRfq} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Supplier</label>
              <select
                required
                value={rfqPartyId}
                onChange={(e) => setRfqPartyId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {thirdParties
                  .filter((tp) => tp.party_type === 'supplier' || tp.party_type === 'customer_supplier')
                  .map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Incoterm</label>
              <select
                value={rfqIncoterm}
                onChange={(e) => setRfqIncoterm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {INCOTERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">RFQ Subject</label>
            <input
              type="text"
              required
              value={rfqTitle}
              onChange={(e) => setRfqTitle(e.target.value)}
              placeholder="e.g. Q2 Aluminum Enclosure Batch"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Catalog Item</label>
              <select
                value={rfqProductId}
                onChange={(e) => setRfqProductId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Qty</label>
              <input
                type="number"
                min={1}
                value={rfqQty}
                onChange={(e) => setRfqQty(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Target Unit Price
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={rfqPrice}
                onChange={(e) => setRfqPrice(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingRfq && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Deadline</label>
                <input
                  type="date"
                  value={rfqDeadline}
                  onChange={(e) => setRfqDeadline(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={rfqStatus}
                  onChange={(e) => setRfqStatus(e.target.value as SupplierRfq['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="open">Open</option>
                  <option value="quoted">Quoted</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRfqModal(false);
                setEditingRfq(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingRfq ? 'Save Changes' : 'Issue RFQ'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Delete Commercial Record"
        itemLabel={deleteTarget?.label ?? ''}
        warning={deleteTarget?.warning}
        loading={deleteLoading}
        error={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
        onConfirm={executeDelete}
      />
    </div>
  );
}
