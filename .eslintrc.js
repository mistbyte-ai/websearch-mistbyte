module.exports = {
    "env": {
        "node": true,
        "es2021": true
    },
    "extends": "eslint:recommended",
    "overrides": [
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
	"rules": {
		"no-empty": ["error", { "allowEmptyCatch": true }]
	},
	"globals": {
		'Buffer': "writable",
		'process': "writable"
	}
}
