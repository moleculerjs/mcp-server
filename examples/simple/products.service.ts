import type { Context, ServiceSchema, ServiceSettingSchema } from "moleculer";
import { Service as DbService } from "@moleculer/database";
import type { DatabaseMethods, DatabaseServiceSettings } from "@moleculer/database";

export interface ProductEntity {
	id: string;
	name: string;
	price: number;
	quantity: number;
}

type ProductLowQuantityPayload = Pick<ProductEntity, "id" | "quantity">;

export type ActionCreateParams = Partial<ProductEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
}

interface ProductSettings extends DatabaseServiceSettings, ServiceSettingSchema {}

const ProductsService: ServiceSchema<ProductSettings, DatabaseMethods> = {
	name: "products",
	// version: 1

	mixins: [
		DbService({
			adapter: {
				type: "NeDB",
				options: {
					neDB: {
						inMemoryOnly: true
					}
				}
			}
		}) as ServiceSchema
	],

	settings: {
		fields: {
			id: { type: "string", primaryKey: true, columnName: "_id" },
			name: { type: "string", required: true, min: 5 },
			quantity: { type: "number", required: false },
			price: { type: "number", required: false }
		}
	},

	/**
	 * Action Hooks. More info: https://moleculer.services/docs/0.15/actions.html#Action-hooks
	 */
	hooks: {
		before: {
			/**
			 * Register a before hook for the `create` action.
			 * It sets a default value for the quantity field.
			 */
			create(ctx: Context<ActionCreateParams>) {
				if (!ctx.params.quantity) ctx.params.quantity = 0;
			}
		}
	},

	/**
	 * Actions. More info: https://moleculer.services/docs/0.15/actions.html
	 */
	actions: {
		// --- ADDITIONAL ACTIONS ---

		/**
		 * Increase the quantity of the product item.
		 */
		increaseQuantity: {
			description: "Increase the quantity of a product item",
			rest: "PUT /:id/quantity/increase",
			params: {
				id: "string",
				value: "number|integer|positive"
			},
			async handler(ctx: Context<ActionQuantityParams>): Promise<ProductEntity> {
				// Get current quantity
				const adapter = await this.getAdapter(ctx);
				const dbEntry = await adapter.findById<ProductEntity>(ctx.params.id);

				// Compute new quantity
				const newQuantity = dbEntry.quantity + ctx.params.value;

				// Update DB entry. Will emit an event to clear the cache
				const doc = await this.updateEntity<ProductEntity>(ctx, {
					id: ctx.params.id,
					quantity: newQuantity
				});

				return doc;
			}
		},

		/**
		 * Decrease the quantity of the product item.
		 */
		decreaseQuantity: {
			description: "Decrease the quantity of a product item",
			rest: "PUT /:id/quantity/decrease",
			params: {
				id: "string",
				value: "number|integer|positive"
			},
			mcp: {
				annotations: { destructiveHint: true }
			},
			async handler(ctx: Context<ActionQuantityParams>): Promise<ProductEntity> {
				// Get current quantity
				const adapter = await this.getAdapter(ctx);
				const dbEntry = await adapter.findById<ProductEntity>(ctx.params.id);

				// Compute new quantity
				const newQuantity = dbEntry.quantity - ctx.params.value;

				if (newQuantity < 0) throw new Error("Quantity cannot be negative");

				// Update DB entry. Will emit an event to clear the cache
				const doc = await this.updateEntity<ProductEntity>(ctx, {
					id: ctx.params.id,
					quantity: newQuantity
				});

				return doc;
			}
		}
	},

	events: {
		"product.quantity.low": {
			params: {
				id: "string",
				quantity: "number|integer|positive"
			},
			handler(ctx: Context<ProductLowQuantityPayload>) {
				this.logger.warn(
					`The product '${ctx.params.id}' has low quantity: ${ctx.params.quantity}`
				);
			}
		}
	},

	/**
	 * Methods. More info: https://moleculer.services/docs/0.15/services.html#Methods
	 */
	methods: {
		/**
		 * Loading sample data to the collection.
		 * It is called in the DB.mixin after the database
		 * connection establishing & the collection is empty.
		 */
		async seedDB() {
			const adapter = await this.getAdapter();
			await adapter.insertMany([
				{ name: "Samsung Galaxy S10 Plus", quantity: 10, price: 704 },
				{ name: "iPhone 11 Pro", quantity: 25, price: 999 },
				{ name: "Huawei P30 Pro", quantity: 15, price: 679 }
			]);
		}
	},

	async started() {
		const adapter = await this.getAdapter();
		const count = await adapter.count();
		if (count == 0) {
			this.logger.info(`The 'products' collection is empty. Seeding the collection...`);
			await this.seedDB();
			this.logger.info("Seeding is done. Number of records:", await adapter.count());
		}
	}
};

export default ProductsService;
