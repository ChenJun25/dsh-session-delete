
window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const clientStore = require("@deepseek-ai/dsh-client-store");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;
		const Fragment = jsxRuntime.Fragment;

		const DELETE_ROUTE = "/api/session.delete".slice(1);

		const READY_ROUTE = "/api/session.delete/ready".slice(1);

		const NS = "session-delete";

		const BATCH_MENU_ORDER = 550;

		const zh = {
			"menu.deleteSession": "删除会话",
			"dialog.title": "删除此会话？",
			"dialog.desc": "“{title}”及其子会话在本机的全部记录会被永久删除，无法撤销。",
			"dialog.descUntitled": "该会话及其子会话在本机的全部记录会被永久删除，无法撤销。",
			"dialog.cancel": "取消",
			"dialog.confirm": "永久删除",
			"dialog.pending": "正在删除…",
			"dialog.successTitle": "会话已删除",
			"dialog.successDesc": "已删除 {count} 个会话记录及其磁盘文件。",
			"dialog.successDescClosed": "已删除 {count} 个会话记录及其磁盘文件（其中 {closed} 个原本处于打开状态，已一并关闭）。",
			"dialog.failedTitle": "删除失败",
			"dialog.close": "关闭",
			"dialog.failed": "无法删除该会话。",
			"error.sessionActive": "该会话仍有正在运行的工作，请先停止后再删除。",
			"error.sessionActiveKinds": "该会话仍有正在运行的工作（{kinds}），请先停止后再删除。",
			"error.notFound": "该会话已不在列表中（可能已被删除），列表已刷新。",
			"activity.turn": "进行中的回合",
			"activity.subagent": "运行中的子任务",
			"activity.job": "后台任务",
			"activity.schedule": "定时提醒",
			"activity.separator": "、",
			"batch.menu": "批量删除会话…",
			"batch.selected": "已选 {count} 个会话",
			"batch.selectAll": "全选",
			"batch.clear": "清除",
			"batch.cancel": "取消",
			"batch.delete": "删除所选",
			"batch.deleting": "正在删除…",
			"batch.title": "删除 {count} 个会话？",
			"batch.desc": "所选会话（含各自子会话）在本机的全部记录会被永久删除，无法撤销。",
			"batch.successTitle": "批量删除完成",
			"batch.successDesc": "已删除 {count} 个会话记录。",
			"batch.partialDesc": "已删除 {count} 个会话记录；{failed} 个未能删除（会话仍有工作在跑或已不存在）。",
		};

		const en = {
			"menu.deleteSession": "Delete session",
			"dialog.title": "Delete this session?",
			"dialog.desc": "Every record of “{title}” and its sub-sessions on this machine is deleted permanently. This cannot be undone.",
			"dialog.descUntitled": "Every record of this session and its sub-sessions on this machine is deleted permanently. This cannot be undone.",
			"dialog.cancel": "Cancel",
			"dialog.confirm": "Delete permanently",
			"dialog.pending": "Deleting…",
			"dialog.successTitle": "Session deleted",
			"dialog.successDesc": "Deleted {count} session record(s) and their stored files.",
			"dialog.successDescClosed": "Deleted {count} session record(s) and their stored files ({closed} of them was open and has been closed).",
			"dialog.failedTitle": "Delete failed",
			"dialog.close": "Close",
			"dialog.failed": "The session could not be deleted.",
			"error.sessionActive": "This session still has running work. Stop it first, then delete it.",
			"error.sessionActiveKinds": "This session still has running work ({kinds}). Stop it first, then delete it.",
			"error.notFound": "This session is no longer in the list (it may already be deleted); the list has been refreshed.",
			"activity.turn": "a running turn",
			"activity.subagent": "running subagents",
			"activity.job": "background jobs",
			"activity.schedule": "scheduled reminders",
			"activity.separator": ", ",
			"batch.menu": "Batch delete sessions…",
			"batch.selected": "{count} session(s) selected",
			"batch.selectAll": "Select all",
			"batch.clear": "Clear",
			"batch.cancel": "Cancel",
			"batch.delete": "Delete selected",
			"batch.deleting": "Deleting…",
			"batch.title": "Delete {count} sessions?",
			"batch.desc": "Every record of the selected sessions (and their sub-sessions) on this machine is deleted permanently. This cannot be undone.",
			"batch.successTitle": "Batch delete finished",
			"batch.successDesc": "Deleted {count} session record(s).",
			"batch.partialDesc": "Deleted {count} session record(s); {failed} could not be deleted (still running or already gone).",
		};

		const ACTIVITY_LABELS = {
			turn: "activity.turn",
			subagent: "activity.subagent",
			job: "activity.job",
			schedule: "activity.schedule",
		};

		function activityFamilies(activity, t) {
			if (!Array.isArray(activity)) return "";
			const labels = [];
			for (const entry of activity) {
				const kind = entry !== null && typeof entry === "object" ? entry.kind : undefined;
				const key = typeof kind === "string" ? ACTIVITY_LABELS[kind] : undefined;
				if (key === undefined || labels.includes(key)) continue;
				labels.push(key);
			}
			return labels.map((key) => t(key)).join(t("activity.separator") ?? ", ");
		}

		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		async function callDeleteRoute(sessionId) {
			const response = await fetch(DELETE_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: String(sessionId) }),
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok || payload?.ok !== true) {
				const failure = new Error(typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`);
				failure.code = payload?.code;
				failure.activity = payload?.activity;
				throw failure;
			}
			return payload;
		}

		function useNoMenuOpenState() {
			return [false, () => {}];
		}

		function useStoreValue(store, select) {
			const subscribe = react.useCallback((listener) => {
				if (!store) return () => {};
				return store.subscribe(listener);
			}, [store]);
			const getSnapshot = react.useCallback(() => {
				if (!store) return undefined;
				return select(store.getSnapshot());
			}, [store, select]);
			return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}

		const BATCH_SELECTING = {};

		function BatchDeleteMenuItem(props) {
			const { enterBatchDelete, t } = props;
			const useMenuOpenState = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState : useNoMenuOpenState;
			const menuState = useMenuOpenState();
			const setMenuOpen = Array.isArray(menuState) && typeof menuState[1] === "function" ? menuState[1] : () => {};
			return jsx(primitives.MenuItemButton, {
				icon: jsx(primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: () => {
					setMenuOpen(false);
					enterBatchDelete();
				},
				children: t("batch.menu"),
			});
		}

		function BatchSessionRowMark(props) {
			const { sessionId, t } = props;
			const useBatch = typeof props.useBatch === "function" ? props.useBatch : () => BATCH_SELECTING;
			const batch = useBatch((value) => value);
			if (batch === null) return null;
			const selected = batch.selected !== undefined && batch.selected !== null && batch.selected[sessionId] === true;
			const toggle = (event) => {
				event.preventDefault();
				event.stopPropagation();
				props.toggleBatchSelection(String(sessionId));
			};
			return jsx("button", {
				type: "button",
				"data-dsh-batch-mark": "",
				"aria-label": t("batch.selected", { count: selected ? 1 : 0 }),
				onClick: toggle,
				style: {
					appearance: "none",
					background: "0 0",
					border: "0",
					padding: "2px",
					margin: "0 4px 0 0",
					cursor: "pointer",
					display: "inline-flex",
					alignItems: "center",
				},
				children: selected
					? jsx("span", {
						style: {
							width: "16px",
							height: "16px",
							borderRadius: "50%",
							background: "var(--dsw-alias-state-business-primary, #4f6bed)",
							color: "var(--dsw-alias-bg-layer-3, #fff)",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							flex: "none",
						},
						children: jsx(primitives.IconCheckOutlineRegular, { size: 11 }),
					})
					: jsx("span", {
						style: {
							width: "16px",
							height: "16px",
							borderRadius: "50%",
							border: "1.5px solid var(--dsw-alias-label-tertiary)",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							flex: "none",
						},
					}),
			});
		}

		function BatchDeleteOverlay(props) {
			const { t } = props;
			const useBatch = typeof props.useBatch === "function" ? props.useBatch : () => BATCH_SELECTING;
			const batch = useBatch((value) => value);
			if (batch === null) return null;
			if (batch.run !== undefined && batch.run !== null) {
				return jsx(BatchDeleteConfirmForm, {
					run: batch.run,
					settleBatchRun: props.settleBatchRun,
					deleteSession: props.deleteSession,
					t: props.t,
				});
			}
			const selectedIds = Object.keys(batch.selected ?? {});
			const count = selectedIds.length;
			const allIds = typeof props.allSessionIds === "function" ? props.allSessionIds() : [];

			const sidebarRight = () => {
				const mark = window.document.querySelector("[data-dsh-batch-mark]");
				if (mark === null) return 264;
				const rect = mark.getBoundingClientRect();
				return rect.left > 40 ? rect.left : 264;
			};
			const railStyle = {
				position: "fixed",
				left: `${sidebarRight() + 6}px`,
				bottom: "16px",
				width: "40px",
				zIndex: 900,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "2px",
				padding: "6px 4px",
				borderRadius: "10px",
				background: "var(--dsw-alias-bg-layer-2)",
				border: "1px solid var(--dsw-alias-border-l4)",
				boxShadow: "0 8px 28px rgba(0,0,0,.28)",
				color: "var(--dsw-alias-label-primary)",
			};
			const iconButtonStyle = {
				appearance: "none",
				background: "0 0",
				border: "0",
				padding: "6px",
				borderRadius: "8px",
				cursor: "pointer",
				color: "var(--dsw-alias-label-secondary)",
				display: "inline-flex",
			};
			return jsxs("div", {
				role: "toolbar",
				"aria-label": t("batch.menu"),
				"aria-orientation": "vertical",
				style: railStyle,
				children: [
					jsx("span", {
						style: { fontSize: "11px", fontWeight: 600, lineHeight: "16px" },
						children: String(count),
					}),
					jsx("button", {
						type: "button",
						title: t("batch.selectAll"),
						"aria-label": t("batch.selectAll"),
						disabled: allIds.length === 0,
						onClick: () => props.setBatchSelection(allIds),
						style: { ...iconButtonStyle, opacity: allIds.length === 0 ? 0.4 : 1 },
						children: jsx(primitives.IconChecklistOutlineRegular, { size: 16 }),
					}),
					jsx("button", {
						type: "button",
						title: t("batch.clear"),
						"aria-label": t("batch.clear"),
						disabled: count === 0,
						onClick: () => props.setBatchSelection([]),
						style: { ...iconButtonStyle, opacity: count === 0 ? 0.4 : 1 },
						children: jsx(primitives.IconCloseOutlineRegular, { size: 16 }),
					}),
					jsx("button", {
						type: "button",
						title: t("batch.delete"),
						"aria-label": t("batch.delete"),
						disabled: count === 0,
						onClick: () => props.requestBatchRun(selectedIds),
						style: { ...iconButtonStyle, color: count === 0 ? "var(--dsw-alias-label-tertiary)" : "var(--dsw-alias-state-error-primary, #e5484d)", opacity: count === 0 ? 0.4 : 1 },
						children: jsx(primitives.IconTrashOutlineRegular, { size: 16 }),
					}),
					jsx("button", {
						type: "button",
						title: t("batch.cancel"),
						"aria-label": t("batch.cancel"),
						onClick: props.exitBatchDelete,
						style: {
							appearance: "none",
							background: "0 0",
							border: "0",
							marginTop: "4px",
							padding: "3px 2px",
							cursor: "pointer",
							fontSize: "11px",
							lineHeight: "16px",
							color: "var(--dsw-alias-label-tertiary)",
						},
						children: t("batch.cancel"),
					}),
				],
			});
		}

		function BatchDeleteConfirmForm(props) {
			const { run, settleBatchRun, deleteSession, t } = props;
			const [state, setState] = react.useState({ status: "confirm", deleted: 0, failed: 0, error: null });
			const busy = state.status === "deleting";
			const close = () => {
				if (busy) return;
				settleBatchRun();
			};
			const confirm = () => {
				setState({ status: "deleting", deleted: 0, failed: 0, error: null });
				deleteSession(run.sessionIds).then((result) => {
					setState({
						status: "done",
						deleted: result?.deleted ?? 0,
						failed: result?.failed ?? 0,
						error: null,
					});
				}).catch((reason) => {
					setState({ status: "done", deleted: 0, failed: 0, error: messageOf(reason) });
				});
			};

			const title = state.status === "confirm" ? t("batch.title", { count: run.sessionIds.length }) : t("batch.successTitle");
			const description = state.error !== null
				? state.error
				: state.status === "confirm"
					? t("batch.desc")
					: state.failed > 0
						? t("batch.partialDesc", { count: state.deleted, failed: state.failed })
						: t("batch.successDesc", { count: state.deleted });

			return jsxs(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("dialog.close"),
				title,
				description,
				footer: state.status === "confirm"
					? jsxs(Fragment, { children: [
						jsx(primitives.Button, { variant: "outline", disabled: busy, onClick: close, children: t("batch.cancel") }),
						jsx(primitives.Button, { variant: "outline", disabled: busy, onClick: confirm, children: t("batch.delete") }),
					] })
					: jsx(primitives.Button, { variant: "outline", onClick: close, children: t("dialog.close") }),
				children: [
					busy && jsx("div", { role: "status", children: t("batch.deleting") }),
					state.status === "done" && state.error !== null && jsx("div", { role: "alert", children: state.error }),
				],
			});
		}

		function DeleteSessionMenuItem(props) {
			const { sessionId, displayTitle, requestDeleteSession, t } = props;
			const useMenuOpenState = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState : useNoMenuOpenState;
			const menuState = useMenuOpenState();
			const setMenuOpen = Array.isArray(menuState) && typeof menuState[1] === "function" ? menuState[1] : () => {};
			return jsx(primitives.MenuItemButton, {
				icon: jsx(primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: () => {
					setMenuOpen(false);
					requestDeleteSession({
						sessionId: String(sessionId),
						displayTitle: typeof displayTitle === "string" ? displayTitle : "",
					});
				},
				children: t("menu.deleteSession"),
			});
		}

		function DeleteSessionConfirmDialog(props) {
			const request = props.useDeleteRequest((pending) => pending);
			if (request === null) return null;
			return jsx(
				DeleteSessionConfirmForm,
				{
					request,
					settleDeleteRequest: props.settleDeleteRequest,
					deleteSession: props.deleteSession,
					t: props.t,
				},
				request.sessionId,
			);
		}

		function DeleteSessionConfirmForm(props) {
			const { request, settleDeleteRequest, deleteSession, t } = props;
			const [state, setState] = react.useState({ status: "idle", error: null, deleted: 0, closedLive: 0, families: "" });
			const busy = state.status === "deleting";
			const done = state.status === "done";
			const close = () => {
				if (busy) return;
				settleDeleteRequest();
			};
			const confirm = () => {
				setState({ status: "deleting", error: null, deleted: 0, closedLive: 0, families: "" });
				deleteSession(request.sessionId).then((result) => {
					const deleted = Array.isArray(result?.deleted) ? result.deleted.length : 1;
					const closed = Array.isArray(result?.closedLive) ? result.closedLive.length : 0;
					const evicted = Array.isArray(result?.evictedLive) ? result.evictedLive.length : 0;
					setState({ status: "done", error: null, deleted, closedLive: closed + evicted, families: "" });
				}).catch((reason) => {
					const code = reason?.code;
					const families = activityFamilies(reason?.activity, t);
					const localized = code === "session-delete/session-active"
						? (families === "" ? t("error.sessionActive") : t("error.sessionActiveKinds", { kinds: families }))
						: code === "session-delete/not-found"
							? t("error.notFound")
							: null;
					setState({ status: "error", error: localized ?? messageOf(reason), deleted: 0, closedLive: 0, families });
				});
			};

			const title = done ? t("dialog.successTitle") : t("dialog.failedTitle");
			let description;
			if (done) {
				description = state.closedLive > 0
					? t("dialog.successDescClosed", { count: state.deleted, closed: state.closedLive })
					: t("dialog.successDesc", { count: state.deleted });
			} else {
				description = request.displayTitle === ""
					? t("dialog.descUntitled")
					: t("dialog.desc", { title: request.displayTitle });
			}

			return jsxs(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("dialog.close"),
				title: state.status === "error" ? t("dialog.failedTitle") : done ? title : t("dialog.title"),
				description: state.status === "error" ? t("dialog.failed") : description,
				footer: done || state.status === "error"
					? jsx(primitives.Button, { variant: "outline", onClick: close, children: t("dialog.close") })
					: jsxs(Fragment, { children: [
						jsx(primitives.Button, { variant: "outline", disabled: busy, onClick: close, children: t("dialog.cancel") }),
						jsx(primitives.Button, { variant: "outline", disabled: busy, onClick: confirm, children: t("dialog.confirm") }),
					] }),
				children: [
					busy && jsx("div", { role: "status", children: t("dialog.pending") }),
					state.status === "error" && jsx("div", { role: "alert", children: state.error }),
				],
			});
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			const request = clientStore.createSnapshotStore(null);
			const batch = clientStore.createSnapshotStore(null);

			fetch(READY_ROUTE, { method: "POST" }).catch(() => {});

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-delete: browser dictionaries");

			const refreshCatalog = async () => {
				try {
					await ctx.get("sessions")?.refresh();
				} catch (error) {
					console.warn("session-delete: session list refresh failed", error);
				}
			};

			const deleteSession = async (sessionId) => {
				try {
					const result = await callDeleteRoute(sessionId);
					await refreshCatalog();
					return result;
				} catch (error) {

					if (error?.code === "session-delete/not-found") await refreshCatalog();
					throw error;
				}
			};

			const deleteSessions = async (sessionIds) => {
				let deleted = 0;
				let failed = 0;
				for (const sessionId of sessionIds) {
					try {
						await callDeleteRoute(sessionId);
						deleted += 1;
					} catch (error) {
						if (error?.code === "session-delete/session-active" || error?.code === "session-delete/not-found") {
							failed += 1;
							continue;
						}
						await refreshCatalog();
						throw error;
					}
				}
				await refreshCatalog();
				return { deleted, failed };
			};

			const listSnapshot = () => {
				try {
					return ctx.get("sessions")?.list?.getSnapshot() ?? null;
				} catch {
					return null;
				}
			};

			const enterBatchDelete = () => {
				batch.set({ selected: {}, run: null });
			};

			const exitBatchDelete = () => {
				batch.set(null);
			};

			const setBatchSelection = (sessionIds) => {
				const selected = {};
				if (Array.isArray(sessionIds)) {
					for (const sessionId of sessionIds) selected[String(sessionId)] = true;
				}
				batch.set({ selected, run: null });
			};

			const toggleBatchSelection = (sessionId) => {
				const current = batch.getSnapshot();
				if (current === null) return;
				const selected = { ...(current.selected ?? {}) };
				const key = String(sessionId);
				if (selected[key] === true) delete selected[key];
				else selected[key] = true;
				batch.set({ ...current, selected });
			};

			const requestBatchRun = (sessionIds) => {
				const current = batch.getSnapshot();
				if (current === null || !Array.isArray(sessionIds) || sessionIds.length === 0) return;
				batch.set({ ...current, run: { sessionIds: sessionIds.map(String) } });
			};

			const settleBatchRun = () => {
				const current = batch.getSnapshot();
				if (current === null) return;
				batch.set({ selected: {}, run: null });
			};

			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "session-delete",
				order: 500,
				locale: NS,
				inject: () => ({
					requestDeleteSession: (pending) => {
						request.set(pending);
					},
				}),
			}, DeleteSessionMenuItem));

			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "session-delete-batch",
				order: BATCH_MENU_ORDER,
				locale: NS,
				inject: () => ({
					enterBatchDelete,
				}),
			}, BatchDeleteMenuItem));

			ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({
				name: "sidebar.session.row.leading",
				id: "session-delete-batch-mark",
				locale: NS,
				inject: () => ({
					hooks: { batch },
					toggleBatchSelection,
				}),
			}, BatchSessionRowMark));

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "session-delete-confirm",
				locale: NS,
				inject: () => ({
					hooks: { deleteRequest: request },
					settleDeleteRequest: () => {
						request.set(null);
					},
					deleteSession,
				}),
			}, DeleteSessionConfirmDialog));

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "session-delete-batch-overlay",
				locale: NS,
				inject: () => ({
					hooks: { batch },
					toggleBatchSelection,
					setBatchSelection,
					requestBatchRun,
					settleBatchRun,
					exitBatchDelete,
					deleteSession: deleteSessions,
					allSessionIds: () => {
						const snapshot = listSnapshot();
						if (snapshot === null) return [];
						const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(snapshot.byId ?? {});
						return ids.filter((id) => {
							const row = snapshot.byId?.[id];
							return row !== undefined && row !== null && row.blank !== true;
						});
					},
				}),
			}, BatchDeleteOverlay));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
