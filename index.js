'use strict';

const unirest = require('unirest');
const path = require('path');

const crypto = require('crypto');
const tools = require('openssl-cert-tools');
const isUndefined = require('lodash').isUndefined;

const DEBUG = true;

function logDebug(...args) {
	if (DEBUG) {
		console.log.apply(null, args);
	}
}

function AlexaSkillsApi(skillId, messages, intents) {

	let api = {};

	api.intents = intents;
	api.messages = messages;
	api.skillId = skillId;

	function handleError(message, obj) {
		console.log(`ERROR: ${message}`);
		if (obj) {
			console.log(obj);
		}
		return false;
	}

	function howOld(timestamp) {
		// Return seconds
		let _timestamp = new Date(timestamp);
		let serverTime = new Date();
		return (serverTime.getTime() - _timestamp.getTime()) / 1000;
	}

	function validateRequest(req) {
		let body = JSON.parse(req.body);
		let headers = req.headers;

		try {
			let signed = new Promise((resolve) => {
				if (isUndefined(headers)) {
					resolve(handleError('No headers.'));
				}
				// Check for good signature url
				if (isUndefined(headers.signaturecertchainurl)) {
					resolve(handleError('No signature url.'));
				} else {
					// Returns https:/s3.amazonaws.com/echo.api/echo-api-cert-4.pem
					// or      https:/s3.amazonaws.com:443/echo.api/echo-api-cert-4.pem
					// The protocol is equal to https (case insensitive).
					// The hostname is equal to s3.amazonaws.com (case insensitive).
					// The path starts with /echo.api/ (case sensitive).
					let nPath = path.normalize(headers.signaturecertchainurl); // protocol missing second slash here
					if (nPath.substring(0, 7).toLowerCase() !== 'https:/') {
						resolve(handleError('Invalid signature protocol.'));
					}
					if (nPath.substring(7, 23).toLowerCase() !== 's3.amazonaws.com') {
						resolve(handleError('Invalid signature domain.'));
					}
					if (nPath.substring(23, 27).toLowerCase() !== ':443') {
						if (nPath.substring(23, 33).toLowerCase() !== '/echo.api/') {
							resolve(handleError('Invalid signature path.'));
						}
					} else {
						if (nPath.substring(27, 37).toLowerCase() !== '/echo.api/') {
							resolve(handleError('Invalid secure signature path.'));
						}
					}
				}
				// Verify signature
				if (isUndefined(headers.signature)) {
					resolve(handleError('No signature.'));
				} else {
					// Certificate URL is already validated, so might as well validate the contents.
					// 1. Fetch cert.
					// 2. Validate cert.
					// 3. Validate signature.
					let getCertificate = new Promise((resolve) => {
						unirest.get(headers.signaturecertchainurl).end((result) => {
							resolve(result);
						});
					});

					getCertificate.then((result) => {
						if (result.status === 200) {
							let certification = result.body;

							let getCertificateInfo = new Promise((resolve, reject) => {
								return tools.getCertificateInfo(certification, (err, info) => {
									if (err) {
										reject(err);
									} else {
										resolve(info);
									}
								});
							});

							getCertificateInfo.then((info) => {
								if (info.subject.CN.indexOf('echo-api.amazon.com') === -1) {
									resolve(handleError('Certificate missing required subjectAltName.'));
								}

								if (info.remainingDays < 1) {
									resolve(handleError('Certificate expired.'));
								}

								logDebug('certificate current and from valid location.');

								let verifier = crypto.createVerify('RSA-SHA1');
								logDebug('verifier created');
								verifier.update(req.rawBody);
								logDebug('verifier updated', req.rawBody);
								let verified = verifier.verify(certification, headers.signature, 'base64');
								logDebug('verifying complete', verified);
								if (!verified) {
									resolve(handleError('Invalid signature.'));
								}

								resolve(true);
							}, (err) => {
								resolve(handleError('Error retrieving certificate info.', err));
							});
						} else {
							resolve(handleError('Certificate not present at URL.'));
						}
					});
				}
			});

			return signed.then((valid) => {
				logDebug('signed correctly', valid);

				if (!valid) {
					return valid;
				}

				// Check for request as a whole
				if (isUndefined(body)) {
					return handleError('No request.');
				}
				// Make sure request exists
				if (isUndefined(body.request)) {
					return handleError('Missing request.');
				}
				// Check timestamp
				if (isUndefined(body.request.timestamp)) {
					return handleError('Missing timestamp.');
				}
				if (howOld(body.request.timestamp) > 100) {
					return handleError('Old request.', howOld(body.request.timestamp));
				}
				// Check request type
				if (isUndefined(body.request.type)) {
					return handleError('Missing request type.');
				}
				// Check for valid request type
				if (['LaunchRequest', 'IntentRequest', 'SessionEndedRequest'].indexOf(body.request.type) < 0) {
					return handleError('Invalid request type.');
				}
				// CHeck for valid intents
				if (body.request.type === 'IntentRequest' && (isUndefined(body.request.intent) || !api.intents[body.request.intent.name])) {
					return handleError('Invalid intent.');
				}
				// Check for applicationId
				if (isUndefined(body.session)) {
					return handleError('Missing session.');
				}
				if (isUndefined(body.session.application) || isUndefined(body.session.application.applicationId)) {
					return handleError('Missing applicationId.');
				}
				// Validate applicationId
				if (body.session.application.applicationId !== api.skillId) {
					return handleError('Invalid applicationId.');
				}
				// Validate version
				if (body.version !== '1.0') {
					return handleError('Invalid version.');
				}

				return true;
			});


		} catch(err) {
			return new Promise((resolve) => {
				resolve(handleError('JavaScript error.', err));
			});
		}
	}

	api.formatResponse = function (output, reprompt, endSession) {

		let data = {
			'version': '1.0',
			'response': {
				'outputSpeech': {
					'type': 'SSML',
					'ssml': `<speak>${output}</speak>`
				},
				'shouldEndSession': !!endSession
			},
			'sessionAttributes': {}
		};

		if (reprompt) {
			data.response.reprompt = {
				'outputSpeech': {
				'type': 'SSML',
				'ssml': `<speak>${reprompt}</speak>`
			}};
		}

		return data;
	};

	api.handleAll = (method, req, res) => {
		function errorHandler(requestBody, res) {
			res.send(api.formatResponse(api.messages.error.output, api.messages.error.reprompt));
		}

		validateRequest(req).then((valid) => {
			if (valid) {
				try {
					let requestBody = JSON.parse(req.body);

					// Get the request type "request":
					let requestType = requestBody.request.type;
					if (requestType === 'LaunchRequest') {
						res.send(api.formatResponse(api.messages.launch.output));
					} else if (requestType === 'IntentRequest') {
						try {
							api.intents[requestBody.request.intent.name](requestBody, res);
						} catch(err) {
							handleError(`Intent handler for ${requestBody.request.intent.name} failed.`, err);
							errorHandler(requestBody, res);
						}
					} else if (requestType === 'SessionEndedRequest') {
						logDebug('Session ended', requestBody.reason);
						// res.send(formatResponse(api.messages.endSession.output));
					}
				} catch (err) {
					res.send(api.formatResponse(api.messages.error.output, api.messages.error.reprompt));
				}

			} else {
				// For security purposes
				// return 400 Bad Request
				// res.send(formatResponse(api.messages.error.output, api.messages.error.reprompt, true));
				res.status(400).send();
			}
		});
	};

	return api;
}

module.exports = AlexaSkillsApi;
