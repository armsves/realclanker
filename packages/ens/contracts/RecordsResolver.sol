// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice ENSv2 text records, plus the empty profile reads the ENS app always requests.
contract RecordsResolver {
    address public immutable writer;
    mapping(bytes32 node => mapping(string key => string value)) private records;

    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);

    error NotWriter();
    error CallFailed();

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

    function addr(bytes32) external pure returns (address) {
        return address(0);
    }

    function addr(bytes32, uint256) external pure returns (bytes memory) {
        return "";
    }

    function contenthash(bytes32) external pure returns (bytes memory) {
        return "";
    }

    function ABI(bytes32, uint256) external pure returns (uint256, bytes memory) {
        return (0, "");
    }

    function pubkey(bytes32) external pure returns (bytes32, bytes32) {
        return (bytes32(0), bytes32(0));
    }

    function name(bytes32) external pure returns (string memory) {
        return "";
    }

    function multicall(bytes[] calldata data) external view returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool ok, bytes memory result) = address(this).staticcall(data[i]);
            if (!ok) revert CallFailed();
            results[i] = result;
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x59d1d43c || // text(bytes32,string)
            interfaceId == 0x3b3b57de || // addr(bytes32)
            interfaceId == 0xf1cb7e06 || // addr(bytes32,uint256)
            interfaceId == 0xbc1c58d1 || // contenthash(bytes32)
            interfaceId == 0x2203ab56 || // ABI(bytes32,uint256)
            interfaceId == 0xc8690233 || // pubkey(bytes32)
            interfaceId == 0x691f3431 || // name(bytes32)
            interfaceId == 0xac9650d8; // multicall(bytes[])
    }
}
