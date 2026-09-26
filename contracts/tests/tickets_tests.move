#[test_only]
module realclanker::tickets_tests;

use realclanker::tickets::{Self, Pool, Ticket};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;

#[test]
fun buy_mints_one_ticket() {
    let admin = @0xA11CE;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(admin);
    {
        tickets::create_pool(2, 100, scenario.ctx());
    };
    scenario.next_tx(buyer);
    {
        let mut pool = scenario.take_shared<Pool>();
        let payment = coin::mint_for_testing<SUI>(150, scenario.ctx());
        let (ticket, change) = tickets::buy(
            &mut pool,
            payment,
            b"show",
            b"swift-otter.realclanker.eth",
            b"human-a",
            b"ticket-hash",
            scenario.ctx(),
        );
        transfer::public_transfer(ticket, buyer);
        transfer::public_transfer(change, buyer);
        assert!(tickets::sold(&pool) == 1);
        test_scenario::return_shared(pool);
    };
    scenario.next_tx(buyer);
    {
        let ticket = scenario.take_from_sender<Ticket>();
        scenario.return_to_sender(ticket);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = tickets::ESoldOut)]
fun sold_out_aborts() {
    let admin = @0xA11CE;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(admin);
    {
        tickets::create_pool(1, 10, scenario.ctx());
    };
    scenario.next_tx(buyer);
    {
        let mut pool = scenario.take_shared<Pool>();
        let (ticket, change) = tickets::buy(
            &mut pool,
            coin::mint_for_testing<SUI>(10, scenario.ctx()),
            b"show",
            b"a.eth",
            b"h1",
            b"hash-1",
            scenario.ctx(),
        );
        transfer::public_transfer(ticket, buyer);
        transfer::public_transfer(change, buyer);
        let (_ticket, _change) = tickets::buy(
            &mut pool,
            coin::mint_for_testing<SUI>(10, scenario.ctx()),
            b"show",
            b"b.eth",
            b"h2",
            b"hash-2",
            scenario.ctx(),
        );
        transfer::public_transfer(_ticket, buyer);
        transfer::public_transfer(_change, buyer);
        test_scenario::return_shared(pool);
    };
    scenario.end();
}
