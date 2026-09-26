// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice ENSv2 text records for names whose shared public resolver cannot see subname owners.
contract RecordsResolver {
    address public immutable writer;
    mapping(bytes32 node => mapping(string key => string value)) private records;

    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);

    error NotWriter();

    constructor(address writer_) {
        writer = writer_;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        if (msg.sender != writer) revert NotWriter();
        records[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return records[node][key];
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
