'use strict';

var express = require('express');
var router = express.Router();
let skillId = process.env.appId || '123456789';

const BOOK_LIST = [
    {
        'title': 'The Adventures of Huckleberry Finn',
        'author': 'Mark Twain'
    },
	{
		'title': 'Hamlet',
		'author': 'William Shakespeare'
	},
	{
		'title': 'Moby Dick',
		'author': 'Herman Melville'
	},
	{
		'title': 'The Odyssey',
		'author': 'Homer'
	},
	{
		'title': 'Invisible Man',
		'author': 'Ralph Ellison'
	}
];
const AlexaSkillsApi = require('alexa-skills-api');

const messages = {
	'launch': {
		'output': 'Random Books. Please request a book.'
	},
	'help': {
		'output': `Here are some things you can say: give me a random book, give me a book to read, or what book I should read. You can also say, stop, if you're done. So, how can I help?`
	},
	'cancel': {
		'output': 'Good-bye'
	},
	'stop': {
		'output': 'Good-bye'
	},
	'error': {
		'output': 'An error occurred retrieving your request. Please request a random book.',
		'reprompt': 'Try asking for a random book.'
	},
	'found': {
		'reprompt': 'If you would like a new random book, please request a new book.'
	}
};

const intents = {
	'GetRandomBook': getRandomBookIntentHandler,
	'AMAZON.HelpIntent': helpIntentHandler,
	'AMAZON.StopIntent': stopIntentHandler,
	'AMAZON.CancelIntent': cancelIntentHandler
};

let api = new AlexaSkillsApi(skillId, messages, intents);

function getRandomBook(resolve) {
	const book = BOOK_LIST[Math.floor(Math.random() * BOOK_LIST.length)];
	let message = `If you're looking for a random book to read, check out ${book.title} by ${book.author}`;

	resolve(api.formatResponse(`${message}! ${api.messages.found.reprompt}`, messages.found.reprompt));
}

function getRandomBookIntentHandler(requestBody, res) {
	let deferred = new Promise((resolve, reject) => {
		return getRandomBook(resolve, reject);
	});

	deferred.then((data) => {
		res.send(data);
	});
}

function helpIntentHandler(requestBody, res) {
	res.send(api.formatResponse(api.messages.help.output, api.messages.help.reprompt));
}

function stopIntentHandler(requestBody, res) {
	res.send(api.formatResponse(api.messages.stop.output, api.messages.stop.reprompt, true));
}

function cancelIntentHandler(requestBody, res) {
	res.send(api.formatResponse(api.messages.cancel.output, api.messages.cancel.reprompt, true));
}

router.post('/', (req, res) => api.handleAll('POST', req, res));

module.exports = router;
