/** A relation read that cannot establish complete, lossless enumeration. */
export class RelationReadError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(`Incomplete issue relations: ${message}`, options);
		this.name = "RelationReadError";
	}
}
