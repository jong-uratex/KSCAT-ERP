# KSCAT-ERP

**Version:** 1.0.0  
**Organization:** KS Cross Asia Technologies Inc.  

**KSCAT-ERP** is a comprehensive, modular Enterprise Resource Planning (ERP) web application designed to centralize core business operations—spanning Customer Relationship Management (CRM), Supply Chain, Manufacturing, Commerce, Point of Sale (POS), Finance, Project Management, Human Resources, and AI-assisted Workspace Tools—into a single, unified platform.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Core Modules & Features](#core-modules--features)
3. [Key System Capabilities](#key-system-capabilities)
4. [Getting Started & How to Use](#getting-started--how-to-use)
5. [User Roles & Security (RBAC)](#user-roles--security-rbac)
6. [Tech Stack & Architecture](#tech-stack--architecture)

---

## 🔍 Overview

Built to streamline end-to-end organizational workflows, KSCAT-ERP connects front-office sales and customer support with back-office inventory, manufacturing, accounting, and HR. Every module supports full data management (Create, Read, Edit, Delete) backed by atomic balance adjustments, relational integrity checks, role-based access control, and an immutable system audit trail.

---

## 🧩 Core Modules & Features

KSCAT-ERP is organized into 18 integrated modules grouped across functional business domains:

### 1. Overview
* **Dashboard:** Centralized executive view displaying key operational metrics, financial summaries, and quick-access insights across active modules.

### 2. CRM & Directory
* **Third Parties & CRM:** Manage customers, prospects, suppliers, and vendor contacts. Track interaction history, account statuses, and commercial relationships.

### 3. Supply Chain
* **Products & Stock:** Maintain product catalogs, SKUs, barcodes, pricing tiers, and real-time stock levels across warehouses.
* **Manufacturing & BOM:** Define Bills of Materials (BOM), schedule production runs, and track manufacturing orders from raw components to finished goods.

### 4. Commerce
* **Proposals & Orders:** Create commercial proposals/quotes, convert them into Sales Orders, and manage Purchase Orders for supplier restocking.
* **TakePOS Register:** Integrated Point of Sale interface for fast retail/counter checkout, receipt handling, and automatic inventory deduction.

### 5. Finance
* **Finance & Accounting:** Manage customer invoices, vendor bills, payment tracking, ledger balances, and financial reporting.

### 6. Service & Collaboration
* **Tickets & Knowledge:** Helpdesk ticketing system for tracking customer or internal issues alongside a centralized Knowledge Base for standard operating procedures and FAQs.
* **Projects & Agenda:** Plan projects, assign tasks, track milestones, and manage team schedules and calendars.

### 7. People
* **Human Resources:** Manage employee directories, roles, department assignments, attendance, and personnel records.

### 8. Workspace Tools
* **EDM, Tools & AI:** Electronic Document Management (EDM) for file storage and organization, paired with built-in productivity utilities and AI-powered assistance.

### 9. Account & System
* **User Profile:** Personal account settings, password management, and Multi-Factor Authentication (MFA) configuration.
* **Settings & Administration:**
  * **Users & Roles:** Create, activate/deactivate, and assign roles to system users.
  * **RBAC Matrix:** Granular Role-Based Access Control configuration across all modules.
  * **Security Policy:** Enforce password rules, session controls, and MFA requirements.
  * **ERP Modules:** Enable or disable specific modules (up to 18 modules) tailored to business needs.
  * **Integrations:** Connect external APIs and third-party services.
  * **System Audit Log:** Immutable, chronological log recording all creations, edits, and deletions across the platform.

---

## ⚡ Key System Capabilities

* **Global Quick Search (`Ctrl + K` / `⌘ + K`):** Instantly search from the top navigation bar across customers, products, proposals, sales/purchase orders, invoices, projects, tickets, employees, and manufacturing orders by name, reference code, email, barcode, or numeric ID. Supports full keyboard navigation (`↑`, `↓`, `Enter`) and automatically scopes results to the logged-in user's permissions.
* **Full Inline CRUD Operations:** Every data table and card view across all modules supports creating, editing, and deleting records via modal dialogs with built-in confirmation prompts.
* **Data Integrity & Atomic Transactions:** Deleting or modifying records automatically validates linked dependencies to prevent orphaned data and updates financial and stock balances atomically.
* **Immutable Audit Trail:** Every data mutation is logged with user attribution and timestamps to ensure compliance and traceability.

---

## 🚀 Getting Started & How to Use

### Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/kscat-erp.git](https://github.com/your-username/kscat-erp.git)
   cd kscat-erp
