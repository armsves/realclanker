/// Ticket pool for RealClanker.
/// A verified purchase pays SUI and receives a unique Ticket object.
module realclanker::tickets;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

public struct Ticket has key, store {
    id: UID,
    concert_id: vector<u8>,
    holder_ens: vector<u8>,
    human_hash: vector<u8>,
    serial: u64,
    ticket_hash: vector<u8>,
}

public struct Pool has key {
    id: UID,
    admin: address,
    supply: u64,
    sold: u64,
    price: u64,
    treasury: Balance<SUI>,
}

public struct TicketMinted has copy, drop {
    ticket_id: ID,
    serial: u64,
}

const ESoldOut: u64 = 0;
const EUnderpaid: u64 = 1;
const ENotAdmin: u64 = 2;

public fun create_pool(supply: u64, price: u64, ctx: &mut TxContext) {
    let pool = Pool {
        id: object::new(ctx),
        admin: tx_context::sender(ctx),
        supply,
        sold: 0,
        price,
        treasury: balance::zero<SUI>(),
    };
    transfer::share_object(pool);
}

public fun buy(
    pool: &mut Pool,
    mut payment: Coin<SUI>,
    concert_id: vector<u8>,
    holder_ens: vector<u8>,
    human_hash: vector<u8>,
    ticket_hash: vector<u8>,
    ctx: &mut TxContext,
): (Ticket, Coin<SUI>) {
    assert!(pool.sold < pool.supply, ESoldOut);
    assert!(coin::value(&payment) >= pool.price, EUnderpaid);
    let paid = coin::split(&mut payment, pool.price, ctx);
    balance::join(&mut pool.treasury, coin::into_balance(paid));
    pool.sold = pool.sold + 1;
    let ticket = Ticket {
        id: object::new(ctx),
        concert_id,
        holder_ens,
        human_hash,
        serial: pool.sold,
        ticket_hash,
    };
    event::emit(TicketMinted {
        ticket_id: object::id(&ticket),
        serial: ticket.serial,
    });
    (ticket, payment)
}

public fun withdraw(pool: &mut Pool, ctx: &mut TxContext): Coin<SUI> {
    assert!(tx_context::sender(ctx) == pool.admin, ENotAdmin);
    let amount = balance::value(&pool.treasury);
    coin::from_balance(balance::split(&mut pool.treasury, amount), ctx)
}

public fun sold(pool: &Pool): u64 { pool.sold }

public fun supply(pool: &Pool): u64 { pool.supply }
