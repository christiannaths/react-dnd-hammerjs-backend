/**
 * Copyrights licensed under the MIT License. See the accompanying LICENSE file for terms.
 */

import invariant from 'invariant';
import Hammer from 'hammerjs';

function getEventClientOffset(e) {
    return e.center;
}

const ELEMENT_NODE = 1;
function getNodeClientOffset(node) {
    const el = node.nodeType === ELEMENT_NODE
        ? node
        : node.parentElement;

    if (!el) {
        return null;
    }

    const {top, left} = el.getBoundingClientRect();
    return {x: left, y: top};
}

const eventNames = {
    mouse: {
        start: 'mousedown',
        move: 'mousemove',
        end: 'mouseup'
    },
    touch: {
        start: 'touchstart',
        move: 'touchmove',
        end: 'touchend'
    }
};

const listeners = {};

export class HammerJSBackend {
    constructor(manager, opts = {}) {
        const options = {
            delayDragStart: 0,
            ...opts
        };

        this.actions = manager.getActions();
        this.monitor = manager.getMonitor();
        this.registry = manager.getRegistry();

        this.delayTouchStart = options.delayTouchStart;
        this.delayMouseStart = options.delayMouseStart;
        this.sourceNodes = {};
        this.sourceNodeOptions = {};
        this.sourcePreviewNodes = {};
        this.sourcePreviewNodeOptions = {};
        this.targetNodeOptions = {};
        this.listenerTypes = [];
        this._mouseClientOffset = {};

        this.getSourceClientOffset = this.getSourceClientOffset.bind(this);
        this.handleTopMoveStart = this.handleTopMoveStart.bind(this);
        this.handleTopMoveStartDelay = this.handleTopMoveStartDelay.bind(this);
        this.handleTopMoveStartCapture = this.handleTopMoveStartCapture.bind(this);
        this.handleTopMoveCapture = this.handleTopMoveCapture.bind(this);
        this.handleTopMove = this.handleTopMove.bind(this);
        this.handleTopMoveEndCapture = this.handleTopMoveEndCapture.bind(this);
    }

    getOnPanStart() {
        if (!this.onPanStart) {
            this.onPanStart = (ev) => {
              this.handleTopMoveStartCapture(ev);
              this.getTopMoveStartHandler()(ev);
            };
        }

        return this.onPanStart;
    }

    getOnPanning() {
        if (!this.onPanning) {
            this.onPanning = (ev) => {
              this.handleTopMoveCapture(ev);
              this.handleTopMove(ev);
            };
        }

        return this.onPanning;
    }

    getOnPanEnd() {
        if (!this.onPanEnd) {
            this.onPanEnd = (ev) => {
              this.handleTopMoveEndCapture(ev);
            };
        }

        return this.onPanEnd;
    }

    setup() {
        if (typeof window === 'undefined') {
            return;
        }

        invariant(!this.constructor.isSetUp, 'Cannot have two Touch backends at the same time.');
        this.constructor.isSetUp = true;

        // Insert HammerJS
        this.addEventListener(window, 'panstart', this.getOnPanStart());
        this.addEventListener(window, 'pan', this.getOnPanning());
        this.addEventListener(window, 'panend', this.getOnPanEnd());
    }

    teardown() {
        if (typeof window === 'undefined') {
            return;
        }

        this.constructor.isSetUp = false;
        this._mouseClientOffset = {};

        // Insert HammerJS
        this.removeEventListener(window, 'panstart', this.getOnPanStart());
        this.removeEventListener(window, 'pan', this.getOnPanning());
        this.removeEventListener(window, 'panend', this.getOnPanEnd());

        this.uninstallSourceNodeRemovalObserver();
    }

    addEventListener(subject, event, handler) {
        const listener = listeners[subject] || new Hammer(subject);
        listener.on(event, handler);
    }

    removeEventListener(subject, event, handler) {
        const listener = listeners[subject];
        if (listener) {
          listener.off(event, handler);
        }
    }

    connectDragSource(sourceId, node) {
        const handleMoveStart = this.handleMoveStart.bind(this, sourceId);
        this.sourceNodes[sourceId] = node;

        this.addEventListener(node, 'panstart', handleMoveStart);

        return () => {
            delete this.sourceNodes[sourceId];
            this.removeEventListener(node, 'panstart', handleMoveStart);
        };
    }

    connectDragPreview(sourceId, node, options) {
        this.sourcePreviewNodeOptions[sourceId] = options;
        this.sourcePreviewNodes[sourceId] = node;

        return () => {
            delete this.sourcePreviewNodes[sourceId];
            delete this.sourcePreviewNodeOptions[sourceId];
        };
    }

    connectDropTarget(targetId, node) {
        const handleMove = (e) => {
            let coords;

            /**
             * Grab the coordinates for the current mouse/touch position
             */
            switch (e.type) {
                case eventNames.mouse.move:
                    coords = {
                        x: e.clientX,
                        y: e.clientY
                    };
                    break;

                case eventNames.touch.move:
                    coords = {
                        x: e.touches[0].clientX,
                        y: e.touches[0].clientY
                    };
                    break;
                default:
            }

            /**
             * Use the coordinates to grab the element the drag ended on.
             * If the element is the same as the target node (or any of it's children) then we have hit a drop target and can handle the move.
             */
            const droppedOn = document.elementFromPoint(coords.x, coords.y);
            const childMatch = node.contains(droppedOn);

            if (droppedOn === node || childMatch) {
                return this.handleMove(e, targetId);
            }
        };

        /**
         * Attaching the event listener to the body so that touchmove will work while dragging over multiple target elements.
         */
        this.addEventListener(document.querySelector('body'), 'pan', handleMove);

        return () => {
            this.removeEventListener(document.querySelector('body'), 'pan', handleMove);
        };
    }

    getSourceClientOffset(sourceId) {
        return getNodeClientOffset(this.sourceNodes[sourceId]);
    }

    handleTopMoveStartCapture() {
        this.moveStartSourceIds = [];
    }

    handleMoveStart(sourceId) {
        this.moveStartSourceIds.unshift(sourceId);
    }

    getTopMoveStartHandler() {
        if (!this.delayTouchStart && !this.delayMouseStart) {
            return this.handleTopMoveStart;
        }

        return this.handleTopMoveStartDelay;
    }

    handleTopMoveStart(e) {
        // Don't prematurely preventDefault() here since it might:
        // 1. Mess up scrolling
        // 2. Mess up long tap (which brings up context menu)
        // 3. If there's an anchor link as a child, tap won't be triggered on link

        const clientOffset = getEventClientOffset(e);
        if (clientOffset) {
            this._mouseClientOffset = clientOffset;
        }
    }

    handleTopMoveStartDelay(e) {
        const delay = (e.type === eventNames.touch.start)
            ? this.delayTouchStart
            : this.delayMouseStart;
        this.timeout = setTimeout(this.handleTopMoveStart.bind(this, e), delay);
    }

    handleTopMoveCapture() {
        this.dragOverTargetIds = [];
    }

    handleMove(e, targetId) {
        this.dragOverTargetIds.unshift(targetId);
    }

    handleTopMove(e) {
        clearTimeout(this.timeout);

        const {moveStartSourceIds, dragOverTargetIds} = this;
        const clientOffset = getEventClientOffset(e);

        if (!clientOffset) {
            return;
        }

        // If we're not dragging and we've moved a little, that counts as a drag start
        if (!this.monitor.isDragging() && this._mouseClientOffset.hasOwnProperty('x') && moveStartSourceIds && (this._mouseClientOffset.x !== clientOffset.x || this._mouseClientOffset.y !== clientOffset.y)) {
            this.moveStartSourceIds = null;
            this.actions.beginDrag(moveStartSourceIds, {
                clientOffset: this._mouseClientOffset,
                getSourceClientOffset: this.getSourceClientOffset,
                publishSource: false
            });
        }

        if (!this.monitor.isDragging()) {
            return;
        }

        const sourceNode = this.sourceNodes[this.monitor.getSourceId()];
        this.installSourceNodeRemovalObserver(sourceNode);
        this.actions.publishDragSource();

        e.preventDefault();

        /*
        const matchingTargetIds = Object.keys(this.targetNodes)
            .filter((targetId) => {
                const boundingRect = this.targetNodes[targetId].getBoundingClientRect();
                return clientOffset.x >= boundingRect.left &&
                clientOffset.x <= boundingRect.right &&
                clientOffset.y >= boundingRect.top &&
                clientOffset.y <= boundingRect.bottom;
            });
        */

        this.actions.hover(dragOverTargetIds, {clientOffset: clientOffset});
    }

    handleTopMoveEndCapture(e) {
        if (!this.monitor.isDragging() || this.monitor.didDrop()) {
            this.moveStartSourceIds = null;
            return;
        }

        e.preventDefault();

        this._mouseClientOffset = {};

        this.uninstallSourceNodeRemovalObserver();
        this.actions.drop();
        this.actions.endDrag();
    }

    installSourceNodeRemovalObserver(node) {
        this.uninstallSourceNodeRemovalObserver();

        this.draggedSourceNode = node;
        this.draggedSourceNodeRemovalObserver = new window.MutationObserver(() => {
            if (!node.parentElement) {
                this.resurrectSourceNode();
                this.uninstallSourceNodeRemovalObserver();
            }
        });

        if (!node || !node.parentElement) {
            return;
        }

        this.draggedSourceNodeRemovalObserver.observe(node.parentElement, {childList: true});
    }

    resurrectSourceNode() {
        this.draggedSourceNode.style.display = 'none';
        this.draggedSourceNode.removeAttribute('data-reactid');
        document.body.appendChild(this.draggedSourceNode);
    }

    uninstallSourceNodeRemovalObserver() {
        if (this.draggedSourceNodeRemovalObserver) {
            this.draggedSourceNodeRemovalObserver.disconnect();
        }

        this.draggedSourceNodeRemovalObserver = null;
        this.draggedSourceNode = null;
    }
}

export default function createHammerJSBackend(optionsOrManager = {}) {
    const hammerJSBackendFactory = (manager) => {
        return new HammerJSBackend(manager, optionsOrManager);
    };

    if (optionsOrManager.getMonitor) {
        return hammerJSBackendFactory(optionsOrManager);
    }

    return hammerJSBackendFactory;
}
